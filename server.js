// server.js
import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";

const app = express();
const upload = multer(); // Maneja multipart/form-data en memoria

// Para JSON en el agente conversacional
app.use(express.json());

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/* =========================================================
   1) PROMPT DEL AGENTE DE VISIÓN (YA LO TENÍAS)
   ========================================================= */
const INSTRUCCIONES_AGENTE = `
Eres un agente SUPER experto en identificación de EQUIPOS DE RED y CPE usados por operadores de telecomunicaciones.
Conoces muy bien equipos de acceso a Internet, TV, voz fija, equipos empresariales y CPE LTE/5G.

Siempre analizas UNA sola imagen del dispositivo y tu objetivo es clasificarlo en un tipo de equipo específico, identificar la marca
y el modelo más probable, y dar un nivel de confianza.

CLASIFICACIÓN DE EQUIPMENT_TYPE (usa SIEMPRE uno de estos valores EXACTOS, en MAYÚSCULAS):

1. Acceso a Internet / Datos
- ONT
  Terminal óptico de red para fibra (FTTH). Equipos Huawei / ZTE / Nokia, etc. que conectan fibra y entregan ethernet/WiFi.
- MODEM_CABLE
  Módem para HFC (coaxial). Muchas veces combinado con router (cablemodem).
- MODEM_XDSL
  Módem para ADSL/VDSL sobre par de cobre.
- ROUTER
  Router puro, sin módem (recibe WAN por ethernet desde ONT o cablemodem).
- GATEWAY
  Equipo “todo en uno”: módem + router + WiFi (típico en HFC o cobre).
- ACCESS_POINT
  Punto de acceso WiFi adicional (mesh / repetidor gestionado por el operador).
- REPEATER
  Repetidor WiFi simple (extensor de cobertura para hogar).
- MESH_NODE
  Nodo mesh WiFi (soluciones tipo “WiFi Total / WiFi Plus”).

2. TV / Entretenimiento
- DECODER_IPTV
  Decodificador para TV sobre IP (Android TV, IPTV moderno, etc.).
- DECODER_DTH
  Decodificador satelital (Direct-To-Home, con antena/parabólica).
- DECODER_CABLE
  Decodificador para TV por cable coaxial tradicional.

3. Voz (Telefonía fija)
- ATA
  Adaptador telefónico analógico (convierte VoIP a RJ11 para teléfonos tradicionales).
- PHONE_IP
  Teléfono IP dedicado (muy común en empresas).

4. Equipos empresariales / backbone local
- SWITCH
  Switch Ethernet (administrable o no) para oficinas/empresas.
- SWITCH_POE
  Switch con Power over Ethernet para alimentar APs, cámaras, etc.
- OLT
  Equipo de cabecera para FTTH (normalmente en red del operador, no en casa del cliente).
- CMTS
  Equipo de cabecera para redes HFC (también de red del operador).
- FIREWALL
  Equipo de seguridad dedicado (más típico en entornos empresariales).

5. Otros CPE / Equipos especiales
- CPE_LTE
  Router/módem 4G/5G fijo (internet hogar/empresa vía red móvil).
- ROUTER_5G
  Específico para acceso fijo inalámbrico 5G.
- ONT_WIFI_6
  ONT con WiFi 6/6E integrado.
- ROUTER_WIFI_6
  Router WiFi 6/6E.
- HOTSPOT_WIFI
  Dispositivo dedicado a dar WiFi en espacios públicos/empresariales.
- IAD
  Integrated Access Device (datos + voz, típico en empresas).
- OTHER
  Cualquier equipo de red que no encaje claramente en las categorías anteriores.

TU TAREA, A PARTIR DE LA IMAGEN:

1) EQUIPMENT_TYPE:
   - Analiza la forma, puertos (RJ45, fibra, coaxial, RJ11), antenas, serigrafías, LEDs, etc.
   - Elige SIEMPRE uno de los valores anteriores como EQUIPMENT_TYPE.
   - Si no puedes encajarlo con claridad en ninguna categoría, usa "OTHER".

2) BRAND (marca):
   - Identifica, si es posible, la marca: por ejemplo "HUAWEI", "ZTE", "NOKIA", "CISCO", "ARRIS", "TECHNICOLOR", "TP-LINK", etc.
   - Usa null si no se ve claramente o no estás razonablemente seguro.

3) MODEL (modelo):
   - Identifica el modelo si se ve en la etiqueta o en el frontal: por ejemplo "HG8145V5", "ZXHN F660", "HG8245H", etc.
   - Si el modelo no se aprecia o la incertidumbre es alta, deja MODEL en null.

4) MATCH_CONFIDENCE:
   - Calcula un valor entre 0.0 y 1.0 que refleje tu confianza global en la clasificación (EQUIPMENT_TYPE + BRAND + MODEL).
   - 1.0 = totalmente seguro.
   - 0.0 = no se puede identificar prácticamente nada.
   - Considera como confianza BAJA cuando MATCH_CONFIDENCE < 0.6.

5) MESSAGE:
   - Si MATCH_CONFIDENCE < 0.6, debes devolver un mensaje en español empezando con:
     "No se reconoce el equipo con la imagen proporcionada, por favor ajusta la foto para que se vea más ..."
     y completar con indicaciones concretas para mejorar la siguiente foto, por ejemplo:
       - "... centrado el equipo."
       - "... enfocado el logo y la etiqueta del modelo."
       - "... sin reflejos ni contraluces."
       - "... mostrando los puertos traseros y el frontal."
   - Si MATCH_CONFIDENCE >= 0.6, puedes dejar MESSAGE en null o dar una breve recomendación opcional.

SALIDA (FORMATO JSON):

Debes devolver SIEMPRE un JSON con la siguiente estructura EXACTA:

{
  "EQUIPMENT_TYPE": "string",      // uno de los valores definidos arriba (ONT, MODEM_CABLE, DECODER_IPTV, etc.)
  "BRAND": "string | null",        // por ejemplo "HUAWEI", o null si no se identifica
  "MODEL": "string | null",        // por ejemplo "HG8145V5", o null si no se identifica
  "MATCH_CONFIDENCE": 0.0,         // número entre 0.0 y 1.0
  "MESSAGE": "string | null"       // mensaje en español o null
}

REGLAS FINALES MUY IMPORTANTES:
- La respuesta debe ser ÚNICAMENTE el JSON, sin texto antes ni después.
- No incluyas comentarios dentro del JSON.
- EQUIPMENT_TYPE debe ser siempre uno de los valores de la lista proporcionada.
- Usa null cuando no tengas suficiente certeza para BRAND o MODEL.
- Si MATCH_CONFIDENCE < 0.6, MESSAGE es obligatorio y debe explicar claramente cómo mejorar la próxima foto.
`;

/* =========================================================
   2) ENDPOINT: IDENTIFICAR EQUIPO (VISIÓN) - IGUAL QUE ANTES
   ========================================================= */
// POST /api/identificar-equipo
// Recibe un archivo en el campo "imagen"
app.post("/api/identificar-equipo", upload.single("imagen"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Debes enviar un archivo en el campo 'imagen'" });
        }

        // 1. Convertimos la imagen a base64 y luego a data URL
        const base64 = req.file.buffer.toString("base64");
        const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

        // 2. Llamamos al modelo de OpenAI con visión usando chat.completions
        const response = await client.chat.completions.create({
            model: "gpt-4.1-mini", // modelo multimodal con visión
            messages: [
                {
                    role: "system",
                    content: INSTRUCCIONES_AGENTE,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Identifica qué equipo es en la foto y responde solo con el JSON.",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: dataUrl,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 400,
        });

        // 3. Extraemos el texto devuelto por el modelo
        const text = response.choices[0].message.content;

        // 4. Parseamos el JSON que nos devolvió el agente
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return res.status(500).json({
                error: "La respuesta del modelo no fue un JSON válido",
                raw: text,
            });
        }

        // 5. Devolvemos el JSON al cliente
        return res.json(data);
    } catch (err) {
        console.error("Error al identificar equipo:", err);
        return res.status(500).json({ error: "Error interno identificando el equipo" });
    }
});

/* =========================================================
   3) PROMPT DEL AGENTE DE SOPORTE CONVERSACIONAL
   ========================================================= */

const INSTRUCCIONES_SOPORTE = `
Eres un AGENTE VIRTUAL DE SOPORTE TÉCNICO de una empresa de telecomunicaciones.
Tu nombre visible para el cliente es ClaroFix.
Tu objetivo es ayudar a clientes con problemas en sus equipos de red (routers, ONT, decodificadores, etc.)
usando la información de las herramientas y de la base de datos de la compañía.

REGLAS GENERALES
- Habla SIEMPRE en español, de forma clara, cercana y profesional, pero con tono natural, no robótico.
- Usa frases cortas y pasos numerados solo cuando des instrucciones técnicas.
- Nunca inventes datos de cliente, equipos o problemas: usa siempre las herramientas disponibles.
- Si una herramienta devuelve un error o datos vacíos, explícalo de forma sencilla al cliente y ofrece alternativas.
- Evita tecnicismos complejos; si debes usarlos, explícalos en palabras simples.

MEMORIA Y CONTEXTO DE LA CONVERSACIÓN
- Mantén el contexto de toda la conversación.
- Recuerda síntomas, fotos, pasos ya realizados y datos del cliente durante toda la sesión.
- No pidas información que ya fue proporcionada anteriormente en esta misma conversación.
- Continúa siempre el proceso de diagnóstico desde el punto en el que quedó el usuario,
  retomando el último estado lógico (por ejemplo: si ya probaste reiniciar el equipo, no vuelvas a sugerirlo como primer paso).

CASO ESPECIAL: MENSAJE INICIAL O CONTENT VACÍO
- Antes de aplicar cualquier otra regla, revisa SIEMPRE el ÚLTIMO mensaje del usuario.
- Si el último mensaje del usuario tiene el campo content vacío (por ejemplo content = "" o solo espacios en blanco):
  - Responde ÚNICAMENTE con un saludo inicial cálido.
  - NO pidas todavía documento ni número de cuenta.
  - NO llames a ninguna herramienta (no uses get_cliente_por_documento, get_cliente_por_cuenta, get_equipos_cliente ni get_problemas_frecuentes).
  - Ese saludo debe:
    - Presentarte como ClaroFix (solo en este primer mensaje).
    - Transmitir calma y apoyo (“estoy aquí para ayudarte”, “no te preocupes”, etc.).
    - Invitar al usuario a contar su problema con tranquilidad.
    - Incluir un emoji amable (como 😊 o 🙂), variando ocasionalmente.
  - Evita repetir exactamente el mismo saludo cada vez: genera variaciones naturales, pero manteniendo el mismo estilo.
- Ejemplos de estilo (NO los repitas literalmente):
  * “¡Hola! Soy ClaroFix. Estoy aquí para ayudarte con tu equipo, no te preocupes. Cuéntame con calma qué pasó y lo revisamos juntos. 😊”
  * “Hola, soy ClaroFix. Estoy contigo para que tu equipo vuelva a funcionar. Dime qué ocurrió y te guiaré paso a paso.”
  * “¡Hola! Aquí ClaroFix. Tranquilo, te acompaño a revisar tu equipo. Cuéntame qué estás notando y lo solucionamos juntos. 🙂”
- En cualquier otro caso (cuando el content del último mensaje NO está vacío):
  - IGNORA este comportamiento especial y sigue el flujo normal descrito más abajo.
  - NO vuelvas a presentarte como ClaroFix ni a hacer saludos largos en cada respuesta.

FLUJO PRINCIPAL (RESUMIDO)

1) IDENTIFICACIÓN DEL CLIENTE
- Cuando todavía no tengas identificado al cliente:
  - Pide de forma natural que te comparta un dato para buscarlo.
  - Puedes aceptar DOCUMENTO de identidad o NÚMERO DE CUENTA, según lo que el cliente prefiera.
- Usa tu criterio para decidir qué herramienta llamar:
  - Si el usuario menciona "documento", "cédula", "CC", "NIT", o frases como "mi cédula es 1026...", llama a get_cliente_por_documento.
  - Si el usuario menciona "número de cuenta", "mi cuenta es 1001", o algo similar, llama a get_cliente_por_cuenta.
  - Si solo escribe un número sin contexto, primero intenta entenderlo por el mensaje; si no está claro, pregúntale de forma amable si es su documento o su número de cuenta.

1.1) SI NO SE ENCUENTRA EL CLIENTE
- Si get_cliente_por_documento o get_cliente_por_cuenta devuelve null o datos vacíos:
  - Díselo al cliente de forma sencilla (sin ser rígido).
  - Ofrece otra opción, por ejemplo:
    - Si buscaste por documento, ofrece buscar por número de cuenta.
    - Si buscaste por número de cuenta, ofrece buscar por documento.
  - Si tras intentar ambas formas sigues sin encontrarlo, explícalo y sugiere contactar a un asesor humano.

2) DATOS DEL CLIENTE Y EQUIPOS
- Si alguna de las herramientas de cliente devuelve datos válidos:
  - Puedes saludar al cliente por su nombre UNA sola vez al inicio de la interacción identificada
    (por ejemplo: "Hola Karold Pérez, qué gusto saludarte.").
  - No repitas el saludo completo en cada mensaje: después de ese primer saludo, continúa la conversación de forma fluida.
  - Utiliza los equipos que vienen desde el backend (o llama a get_equipos_cliente si es necesario).
  - Muestra el listado de equipos que tiene (tipo, modelo, marca y ubicación) en un tono natural.
  - Si hay varios equipos, pide aclarar con cuál tiene el problema.
  - Indica que, si lo prefiere, puede subir una imagen del equipo con el que tiene el problema, y que tú también puedes ayudarle a partir de esa foto (aunque la foto la procese otro servicio interno).

3) PROBLEMA DEL EQUIPO
- Pregunta de forma abierta: “¿Qué problema notas exactamente?”.
- Resume el síntoma en una frase corta.
- Llama a get_problemas_frecuentes con el modelo de equipo y el síntoma.

4) PASOS DE SOLUCIÓN
- Da instrucciones paso a paso, no todas a la vez.
- Después de 1–2 pasos, pregunta si se solucionó.
- Si tras varios pasos no se resuelve, sugiere escalar a un agente humano y resume lo ya intentado.

ESTILO
- SOLO en el primer mensaje con content vacío usa un saludo completo y cálido.
- En el resto de la conversación, NO repitas saludos largos ni te presentes de nuevo; responde de forma fluida,
  por ejemplo empezando con frases como "Perfecto, entonces...", "Listo, revisemos esto..." o pasando directo a la explicación.
- Mantén siempre un tono empático.
- Prioriza instrucciones concretas y simples.
`;

/* =========================================================
   4) TOOLS (FUNCTION CALLING) PARA EL AGENTE DE SOPORTE
   ========================================================= */

const tools = [
    {
        type: "function",
        function: {
            name: "get_cliente_por_documento",
            description: "Obtiene datos de un cliente por documento o número de cuenta.",
            parameters: {
                type: "object",
                properties: {
                    identificador: {
                        type: "string",
                        description: "Obtiene datos de un cliente usando su documento de identidad y devuelve también los equipos que tiene asociados.",
                    },
                },
                required: ["identificador"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_cliente_por_cuenta",
            description: "Obtiene datos de un cliente usando su número de cuenta.",
            parameters: {
                type: "object",
                properties: {
                    identificador: {
                        type: "string",
                        description: "Obtiene datos de un cliente usando su número de cuenta y devuelve también los equipos que tiene asociados.",
                    },
                },
                required: ["identificador"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_equipos_cliente",
            description: "Lista los equipos de red que tiene un cliente.",
            parameters: {
                type: "object",
                properties: {
                    idCliente: {
                        type: "string",
                        description: "Identificador interno del cliente",
                    },
                },
                required: ["idCliente"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_problemas_frecuentes",
            description:
                "Devuelve problemas frecuentes y pasos de solución para un modelo de equipo y un síntoma específico.",
            parameters: {
                type: "object",
                properties: {
                    modeloEquipo: {
                        type: "string",
                        description: "Modelo del equipo (por ejemplo, HG8145V5)",
                    },
                    sintoma: {
                        type: "string",
                        description: "Resumen corto del problema (por ejemplo, 'sin internet', 'luz roja LOS')",
                    },
                },
                required: ["modeloEquipo", "sintoma"],
            },
        },
    },
];

/* =========================================================
   5) IMPLEMENTACIONES DE EJEMPLO (STUBS) DE LAS TOOLS
   =========================================================
   Luego tú las conectas a tu base de datos real.
*/

// Lista de 10 clientes de ejemplo
const CLIENTES_MOCK = [
    {
        idCliente: "cli-1",
        nombre: "Karold Pérez",
        documento: "1026259098",
        numeroCuenta: "1001",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-2",
        nombre: "Juan Rodríguez",
        documento: "51965155",
        numeroCuenta: "1002",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-3",
        nombre: "María Fernanda López",
        documento: "20067413",
        numeroCuenta: "1003",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-4",
        nombre: "Carlos Andrés Gómez",
        documento: "79254794",
        numeroCuenta: "1004",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-5",
        nombre: "Ana Lucía Martínez",
        documento: "88812345",
        numeroCuenta: "1005",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-6",
        nombre: "Luis Felipe Rojas",
        documento: "1032456789",
        numeroCuenta: "1006",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-7",
        nombre: "Sofía Ramírez",
        documento: "1098765432",
        numeroCuenta: "1007",
        segmento: "Residencial",
    },
    {
        idCliente: "cli-8",
        nombre: "Miguel Ángel Torres",
        documento: "79543210",
        numeroCuenta: "1008",
        segmento: "PYME",
    },
    {
        idCliente: "cli-9",
        nombre: "Laura Daniela Castillo",
        documento: "1122334455",
        numeroCuenta: "1009",
        segmento: "PYME",
    },
    {
        idCliente: "cli-10",
        nombre: "Jorge Enrique Hernández",
        documento: "99887766",
        numeroCuenta: "1010",
        segmento: "Corporativo",
    },
];

// Equipos asociados por idCliente
const EQUIPOS_POR_CLIENTE_MOCK = {
    "cli-1": [
        {
            idEquipoCliente: "eq-1",
            tipo: "ONT",
            modelo: "HG8145V5",
            marca: "HUAWEI",
            ubicacion: "Sala",
        },
        {
            idEquipoCliente: "eq-2",
            tipo: "DECODER_IPTV",
            modelo: "UIW4001",
            marca: "ARRIS",
            ubicacion: "Habitación principal",
        },
    ],
    "cli-2": [
        {
            idEquipoCliente: "eq-3",
            tipo: "ROUTER",
            modelo: "ARCHER C6",
            marca: "TP-LINK",
            ubicacion: "Estudio",
        },
    ],
    "cli-3": [
        {
            idEquipoCliente: "eq-4",
            tipo: "MODEM_CABLE",
            modelo: "TG2492",
            marca: "TECHNICOLOR",
            ubicacion: "Sala",
        },
        {
            idEquipoCliente: "eq-5",
            tipo: "DECODER_CABLE",
            modelo: "TVBOX HD",
            marca: "GENÉRICO",
            ubicacion: "Habitación",
        },
    ],
    "cli-4": [
        {
            idEquipoCliente: "eq-6",
            tipo: "ONT",
            modelo: "ZXHN F660",
            marca: "ZTE",
            ubicacion: "Sala",
        },
    ],
    "cli-5": [
        {
            idEquipoCliente: "eq-7",
            tipo: "CPE_LTE",
            modelo: "B310",
            marca: "HUAWEI",
            ubicacion: "Oficina en casa",
        },
    ],
    "cli-6": [
        {
            idEquipoCliente: "eq-8",
            tipo: "ROUTER_WIFI_6",
            modelo: "AX1800",
            marca: "TP-LINK",
            ubicacion: "Sala",
        },
    ],
    "cli-7": [
        {
            idEquipoCliente: "eq-9",
            tipo: "MESH_NODE",
            modelo: "DECO M4",
            marca: "TP-LINK",
            ubicacion: "Pasillo",
        },
    ],
    "cli-8": [
        {
            idEquipoCliente: "eq-10",
            tipo: "SWITCH_POE",
            modelo: "SG250-08HP",
            marca: "CISCO",
            ubicacion: "Cuarto de equipos",
        },
        {
            idEquipoCliente: "eq-11",
            tipo: "ACCESS_POINT",
            modelo: "UAP-AC-LR",
            marca: "UBIQUITI",
            ubicacion: "Recepción",
        },
    ],
    "cli-9": [
        {
            idEquipoCliente: "eq-12",
            tipo: "FIREWALL",
            modelo: "FORTIGATE 60E",
            marca: "FORTINET",
            ubicacion: "Rack principal",
        },
    ],
    "cli-10": [
        {
            idEquipoCliente: "eq-13",
            tipo: "IAD",
            modelo: "IAD 1230",
            marca: "CISCO",
            ubicacion: "Cuarto de equipos",
        },
        {
            idEquipoCliente: "eq-14",
            tipo: "PHONE_IP",
            modelo: "IP PHONE 7900",
            marca: "CISCO",
            ubicacion: "Gerencia",
        },
    ],
};

async function getClientePorDocumento(identificador) {
    // Busca el cliente por documento (cédula o número de cuenta)
    const cliente = CLIENTES_MOCK.find(
        (c) => c.documento === String(identificador)
    );

    // Si no lo encuentra, devolvemos null (el agente ya sabe manejar "datos vacíos")
    return cliente || null;
}

async function getClientePorCuenta(cuenta) {
    // Busca el cliente por documento (cédula o número de cuenta)
    const cliente = CLIENTES_MOCK.find(
        (c) => c.numeroCuenta === String(cuenta)
    );

    // Si no lo encuentra, devolvemos null (el agente ya sabe manejar "datos vacíos")
    return cliente || null;
}

async function getEquiposCliente(idCliente) {
    // Devuelve los equipos asociados al idCliente
    return EQUIPOS_POR_CLIENTE_MOCK[idCliente] || [];
}

async function getProblemasFrecuentes(modeloEquipo, sintoma) {
    // TODO: reemplazar por consulta real
    // Solo como ejemplo sencillo:
    return {
        modelo: modeloEquipo,
        sintoma,
        pasos: [
            "1. Verifica que el equipo esté encendido y conectado a la corriente.",
            "2. Revisa que el cable que llega al equipo esté bien conectado (fibra/coaxial/par de cobre).",
            "3. Apaga el equipo, espera 30 segundos y vuelve a encenderlo.",
        ],
        recomendacionFinal:
            "Si después de estos pasos el problema continúa, es recomendable escalar el caso a soporte especializado.",
    };
}

/* =========================================================
   6) ENDPOINT: AGENTE DE SOPORTE CONVERSACIONAL
   =========================================================
   POST /api/agente-soporte
   Body esperado (ejemplo):
   {
     "messages": [
       { "role": "user", "content": "Hola, no tengo internet" }
     ]
   }

   El front debe ir enviando el historial completo de la conversación
   (incluyendo respuestas previas del agente) en cada llamada.
*/

app.post("/api/agente-soporte", upload.single("imagen"), async (req, res) => {
    try {
        let { messages } = req.body;

        if (req.file) {
            const resultadoImagen = await manejarImagenEnSoporte(req.file);

            // 1) Armas el objeto que le quieres pasar al modelo
            const payloadDiagnostico = {
                infoEquipo: resultadoImagen?.infoEquipo || null,
                baseConocimiento: BASE_CONOCIMIENTO_EQUIPOS,
                // opcional: también puedes mandar lo que ya dijo el modelo de visión
                mensajeDeteccion: resultadoImagen?.reply || null,
            };

            // 2) Armas el "messages" (aquí se llama input para responses.create)
            const input = [
                {
                    role: "system",
                    content: INSTRUCCIONES_DIAGNOSTICO_EQUIPO,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: JSON.stringify(payloadDiagnostico),
                        },
                    ],
                },
            ];

            // 3) Llamas al modelo de diagnóstico con ese input
            const response = await client.responses.create({
                model: "gpt-4.1-mini", // o el modelo que estés usando
                input,
            });

            // 4) El prompt dice que responde un JSON, lo parseas
            const textoRespuesta = response.output[0].content[0].text;
            const jsonRespuesta = JSON.parse(textoRespuesta);

            agregarHistorialMensaje("assistant", jsonRespuesta.reply);
            // 5) Respondes eso al front
            return res.json({ reply: jsonRespuesta.reply });
            

        } else {
            // ✅ Validamos bien antes de usar messages[0]
            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({
                    error: "Debes enviar un arreglo 'messages' con los mensajes del chat.",
                });
            } else {
                // Tomamos el PRIMER mensaje del arreglo (porque tú lo estás usando así)
                const primerMensaje = messages[0];
                agregarHistorialMensaje("user", primerMensaje.content || "");
            }
        }


        // 1) Primera llamada al modelo, con tools
        const chatMessages = [
            { role: "system", content: INSTRUCCIONES_SOPORTE },
            ...HISTORIAL_CHATS.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        ];

        const completion = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: chatMessages,
            tools,
            tool_choice: "auto",
        });

        const responseMessage = completion.choices[0].message;
        const toolCalls = responseMessage.tool_calls;

        // 2) Si el modelo quiere llamar alguna herramienta
        if (toolCalls && toolCalls.length > 0) {
            // Para simplificar, procesamos solo la PRIMERA tool_call
            const toolCall = toolCalls[0];
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments || "{}");

            let toolResult;

            if (functionName === "get_cliente_por_documento") {
                const cliente = await getClientePorDocumento(args.identificador);

                if (cliente) {
                    const equipos = await getEquiposCliente(cliente.idCliente);
                    toolResult = {
                        ...cliente,
                        equipos, // lista de equipos vinculados al cliente
                    };
                } else {
                    toolResult = null; // el modelo ya sabe manejar "no encontrado"
                }
            } else if (functionName === "get_cliente_por_cuenta") {
                const cliente = await getClientePorCuenta(args.identificador);

                if (cliente) {
                    const equipos = await getEquiposCliente(cliente.idCliente);
                    toolResult = {
                        ...cliente,
                        equipos,
                    };
                } else {
                    toolResult = null;
                }
            } else if (functionName === "get_equipos_cliente") {
                // Dejas esto por si en algún momento el modelo quiere llamar solo a esta tool.
                toolResult = await getEquiposCliente(args.idCliente);
            } else if (functionName === "get_problemas_frecuentes") {
                toolResult = await getProblemasFrecuentes(
                    args.modeloEquipo,
                    args.sintoma
                );
            } else {
                toolResult = { error: "Función no implementada en el backend." };
            }

            // 3) Enviamos al modelo el resultado de la tool para que responda al usuario
            const followUpMessages = [
                ...chatMessages,
                responseMessage, // el mensaje donde el modelo pidió la tool
                {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(toolResult),
                },
            ];

            const secondCompletion = await client.chat.completions.create({
                model: "gpt-4.1-mini",
                messages: followUpMessages,
            });

            const finalText = secondCompletion.choices[0].message.content;

            agregarHistorialMensaje("assistant", finalText);
            return res.json({ reply: finalText });
        }

        // 3) Si NO hay tool calls, devolvemos directamente el contenido
        agregarHistorialMensaje("assistant", responseMessage.content);
        return res.json({ reply: responseMessage.content });
    } catch (err) {
        console.error("Error en /api/agente-soporte:", err);
        return res.status(500).json({
            error: "Error interno en el agente de soporte",
        });
    }
});

const HISTORIAL_CHATS = [];

function agregarHistorialMensaje(role, content) {
    HISTORIAL_CHATS.push({ role, content });
}

/* =========================================================
   7) ARRANQUE DEL SERVICIO
   ========================================================= */

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Servicio REST escuchando en http://localhost:${port}`);
});

async function manejarImagenEnSoporte(file) {
    console.log("Procesando imagen en función aparte...");

    // 1) Pasar la imagen a data URL
    const base64 = file.buffer.toString("base64");
    const dataUrl = `data:${file.mimetype};base64,${base64}`;

    // 2) Llamar al agente de visión
    const response = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
            {
                role: "system",
                content: INSTRUCCIONES_AGENTE, // 👈 tu prompt de visión
            },
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Identifica qué equipo es en la foto y responde solo con el JSON.",
                    },
                    {
                        type: "image_url",
                        image_url: { url: dataUrl },
                    },
                ],
            },
        ],
        max_tokens: 400,
    });

    const text = response.choices[0].message.content;

    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        console.error("No se pudo parsear el JSON de visión:", text);
        return {
            reply:
                "Recibí la imagen, pero no pude identificar bien el equipo. Intenta tomar una foto más clara del frontal y la etiqueta, por favor.",
        };
    }

    // 3) Armar una respuesta sencilla para el usuario
    const { EQUIPMENT_TYPE, BRAND, MODEL, MATCH_CONFIDENCE, MESSAGE } = data;

    if (MATCH_CONFIDENCE < 0.6) {
        return {
            reply:
                MESSAGE ||
                "No se reconoce bien el equipo en la foto, por favor intenta con otra foto más clara.",
            infoEquipo: data,
        };
    }

    return {
        reply: `Por la foto, parece que tu equipo es un ${BRAND || "equipo"} ${MODEL || ""
            } (${EQUIPMENT_TYPE}). Cuéntame qué problema estás notando con ese equipo y te ayudo a revisar.`,
        infoEquipo: data,
    };
}

// =========================================================
// BASE DE CONOCIMIENTO DE EQUIPOS (MANUALES + PROBLEMAS)
// =========================================================

const BASE_CONOCIMIENTO_EQUIPOS = [
    {
        "device_model": "INFINITY 601",
        "device_type": "cablemodem_gateway_docsis",
        "manual_file": "INFINITY 601_Manual de usuario.pdf",
        "description": "Gateway residencial DOCSIS 3.1 con switch integrado y WiFi 802.11a/b/g/n/ac/ax, 4 puertos Gigabit Ethernet y 2 puertos FXS.",
        "key_features": [
            "Compatible con DOCSIS 3.1 y versiones anteriores DOCSIS/EuroDOCSIS 3.0",
            "Funciona como puerta de enlace residencial con 5 puertos de switch + WiFi",
            "4 puertos Gigabit Ethernet, 1 puerto 2.5GbE y 2 puertos FXS para telefonía"
        ],
        "leds": [
            {
                "name": "Power",
                "description": "Indica encendido del equipo (se asume: encendido = tiene energía)."
            },
            {
                "name": "DS/US",
                "description": "Indica sincronismo de downstream/upstream DOCSIS (parpadeo vs fijo sugiere estado de conexión)."
            },
            {
                "name": "Internet",
                "description": "Estado de conexión a Internet a nivel IP (accesibilidad hacia red del operador)."
            },
            {
                "name": "LAN",
                "description": "Estado de enlaces Ethernet hacia dispositivos del cliente."
            },
            {
                "name": "WiFi",
                "description": "Estado de la red inalámbrica local."
            },
            {
                "name": "TEL",
                "description": "Estado de los puertos de telefonía FXS."
            }
        ],
        "buttons": [
            {
                "name": "Reset/Restore Gateway",
                "location": "Interfaz de administración web > Troubleshooting > Reset/Restore Gateway",
                "behavior": "Permite reiniciar o restaurar el Gateway a valores de fábrica. Restaurar borra configuraciones como contraseñas, controles parentales y firewall.",
                "risk_warning": "Restaurar (factory reset) borra todas las configuraciones personalizadas del cliente."
            }
        ],
        "diagnostic_tools": [
            {
                "name": "Logs",
                "description": "Permite ver información de rendimiento y operación del sistema para identificar problemas y riesgos de seguridad.",
                "manual_reference": "Troubleshooting > Logs"
            },
            {
                "name": "Diagnostic Tools",
                "description": "Herramientas para solucionar problemas de conectividad y velocidad de la red (ping, traceroute a direcciones IPv4/IPv6).",
                "manual_reference": "Troubleshooting > Diagnostic Tools"
            },
            {
                "name": "Wi-Fi Spectrum Analyzer",
                "description": "Ayuda a analizar el espectro WiFi para detectar interferencias.",
                "manual_reference": "Troubleshooting > Wi-Fi Spectrum Analyzer"
            }
        ],
        "typical_problems": [
            {
                "id": "INF601-P1",
                "customer_description": "Tengo WiFi pero las páginas no cargan o la conexión es inestable.",
                "probable_causes": [
                    "Problemas de conectividad IP hacia Internet",
                    "Configuración IP incorrecta en el PC o dispositivo",
                    "Interferencias WiFi"
                ],
                "led_pattern_hint": "WiFi encendido, pero posible estado anómalo en LED de Internet o DS/US.",
                "troubleshooting_steps": [
                    "Pedir al cliente que confirme si otros dispositivos también tienen el problema.",
                    "Sugerir revisar/renovar la configuración IP del dispositivo (usar DHCP automático según el manual).",
                    "Proponer usar las herramientas de diagnóstico (ping o traceroute) desde la interfaz web para validar conectividad hacia destinos externos.",
                    "Si sigue fallando, sugerir reinicio del gateway desde Troubleshooting > Reset/Restore Gateway (solo reset, no restore)."
                ]
            },
            {
                "id": "INF601-P2",
                "customer_description": "El Internet se ha vuelto muy lento.",
                "probable_causes": [
                    "Problemas de ruta/red externa",
                    "Interferencias o saturación de canal WiFi",
                    "Consumo elevado de ancho de banda por dispositivos conectados"
                ],
                "led_pattern_hint": "LEDs de DS/US e Internet aparentan normales, pero experiencia percibida es de lentitud.",
                "troubleshooting_steps": [
                    "Pedir al cliente que pruebe con un solo dispositivo por cable para descartar WiFi.",
                    "Sugerir uso de 'Diagnostic Tools' para verificar latencias (ping) y rutas (traceroute).",
                    "Recomendar revisar el 'Wi-Fi Spectrum Analyzer' para cambiar de canal si hay interferencias.",
                    "Si las pruebas indican problemas fuera del hogar, escalar a soporte de red del operador."
                ]
            },
            {
                "id": "INF601-P3",
                "customer_description": "Olvidé la contraseña de administración y los ajustes están desordenados.",
                "probable_causes": [
                    "Cambio de credenciales por parte del cliente",
                    "Configuraciones acumuladas en control parental, firewall, etc."
                ],
                "led_pattern_hint": "LEDs probablemente normales; el problema es de configuración lógica.",
                "troubleshooting_steps": [
                    "Guiar al cliente para acceder a la IP de gestión indicada en la etiqueta del equipo.",
                    "Si no recuerda usuario/clave, explicar opción de restaurar a valores de fábrica desde Troubleshooting > Reset/Restore Gateway, advirtiendo que se perderán ajustes personalizados.",
                    "Tras restaurar, acompañar en un asistente básico de configuración (SSID, contraseña WiFi, etc.)."
                ]
            }
        ],
        "diagnostic_guides": [
            {
                "id": "INF601-GENERAL",
                "title": "Protocolo básico de diagnóstico para Infinity 601",
                "steps": [
                    "Verificar que el equipo esté energizado (LED Power encendido).",
                    "Confirmar estado de LEDs DS/US e Internet para identificar si hay sincronismo DOCSIS y conexión IP.",
                    "Pedir al cliente que pruebe conexión por cable y por WiFi.",
                    "Si el problema es de navegación o velocidad, utilizar 'Diagnostic Tools' desde la GUI web para probar conectividad a destinos de prueba.",
                    "Si los LEDs de red se ven normales pero no hay servicio, escalar a soporte de red.",
                    "Si hay múltiples cambios de configuración, valorar usar Reset/Restore con advertencia explícita al cliente."
                ]
            }
        ]
    },

    // =================== EJEMPLO 2: ZTE ZXHN H3601P V9.4 ===================
    {
        "device_model": "ZXHN F6601P",
        "device_type": "ont_gpon",
        "manual_file": "Manual de Usuario ZXHN F6601P (V9.3).pdf",
        "description": "ONT GPON con interfaces Ethernet, teléfono, WiFi dual band y USB 2.0 para servicios de Internet, IPTV y telefonía.",
        "key_features": [
            "Interfaz GPON SC/APC para acceso de banda ancha",
            "4 puertos Ethernet RJ-45 100/1000 Mbps",
            "1 puerto telefónico RJ-11 (POTS) con soporte SIP",
            "WiFi 2.4GHz y 5GHz (802.11b/g/n/ax y 802.11a/n/ac/ax)",
            "Puerto USB 2.0 para almacenamiento y compartición de archivos"
        ],
        "leds": [
            {
                "name": "Power",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado." },
                    { "value": "blanco fijo", "meaning": "Dispositivo encendido." }
                ]
            },
            {
                "name": "PON",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o aún no comenzó el proceso de registro." },
                    { "value": "blanco fijo", "meaning": "Registro exitoso en la red GPON." },
                    { "value": "blanco parpadeando lento", "meaning": "El dispositivo se está registrando en la red." },
                    { "value": "blanco parpadeando rápido", "meaning": "El dispositivo está siendo actualizado." }
                ]
            },
            {
                "name": "LOS",
                "states": [
                    { "value": "apagado", "meaning": "Potencia óptica recibida normal (sin fallo)." },
                    { "value": "rojo fijo", "meaning": "Transmisor óptico apagado en la interfaz PON." },
                    { "value": "rojo parpadeando", "meaning": "La potencia óptica recibida es menor que la sensibilidad del receptor (posible corte/falla de fibra)." }
                ]
            },
            {
                "name": "Internet",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o no hay conexión WAN con propiedades de Internet configuradas o sesión desconectada." },
                    { "value": "blanco fijo", "meaning": "Hay dirección IP WAN de Internet válida (IPCP, DHCP o estática)." },
                    { "value": "blanco parpadeando", "meaning": "Hay tráfico IP pasando por la conexión WAN." }
                ]
            },
            {
                "name": "Phone",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o servicio de voz no registrado en softswitch/IMS." },
                    { "value": "blanco fijo", "meaning": "Teléfono registrado, sin tráfico de voz." },
                    { "value": "blanco parpadeando", "meaning": "Tráfico de voz en curso." }
                ]
            },
            {
                "name": "LAN1-LAN4",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o sin enlace de red en el puerto." },
                    { "value": "blanco fijo", "meaning": "Enlace establecido, sin transmisión de datos." },
                    { "value": "blanco parpadeando", "meaning": "Datos transmitiéndose o recibiéndose." }
                ]
            },
            {
                "name": "WiFi",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o WiFi desactivado." },
                    { "value": "blanco fijo", "meaning": "WiFi activado, sin transmisión de datos." },
                    { "value": "blanco parpadeando", "meaning": "Datos WiFi en transmisión." }
                ]
            },
            {
                "name": "WPS",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o WPS desactivado." },
                    { "value": "blanco fijo", "meaning": "Algún dispositivo se ha conectado mediante WPS." },
                    { "value": "blanco parpadeando", "meaning": "Dispositivos intentando conectarse o negociación en curso. Un parpadeo rojo indica error o superposición de sesión." }
                ]
            },
            {
                "name": "USB",
                "states": [
                    { "value": "apagado", "meaning": "Dispositivo apagado o interfaz USB no conectada." },
                    { "value": "blanco fijo", "meaning": "USB conectada, funcionando en modo host, sin transmisión de datos." },
                    { "value": "blanco parpadeando", "meaning": "Datos transmitiéndose por la interfaz USB." }
                ]
            }
        ],
        "buttons": [
            {
                "name": "Power",
                "description": "Enciende o apaga el dispositivo después de conectar todos los cables."
            },
            {
                "name": "WPS/Wi-Fi",
                "description": "Controla activación WiFi y WPS.",
                "usage": [
                    "Pulsar hasta 3 segundos: activa o desactiva la función WLAN.",
                    "Pulsar más de 3 segundos: activa o desactiva la función WPS para emparejar dispositivos."
                ]
            },
            {
                "name": "Reset",
                "description": "Reinicia o restaura la configuración.",
                "usage": [
                    "Mantener presionado ~1 segundo: reinicia el dispositivo sin perder configuración.",
                    "Mantener presionado >5 segundos: restaura valores de fábrica."
                ],
                "risk_warning": "El reset prolongado borra todas las configuraciones del usuario."
            }
        ],
        "typical_problems": [
            {
                "id": "F6601P-P1",
                "customer_description": "La luz LOS está roja o parpadeando y no tengo Internet.",
                "probable_causes": [
                    "Falla en la señal óptica (fibra desconectada, dañada o con potencia insuficiente)."
                ],
                "led_pattern_hint": "LOS rojo fijo o parpadeando, PON posiblemente apagado o sin registro.",
                "troubleshooting_steps": [
                    "Pedir al cliente que revise visualmente el cable de fibra: que no esté doblado, aplastado ni desconectado del puerto PON.",
                    "Verificar que el equipo esté encendido (Power blanco fijo).",
                    "Si después de revisar la fibra el LED LOS sigue rojo, indicar que se trata probablemente de un problema externo (red óptica) y que requiere visita técnica.",
                    "Crear o actualizar el caso para soporte de campo."
                ]
            },
            {
                "id": "F6601P-P2",
                "customer_description": "Las luces Power y PON están blancas, pero no puedo navegar por Internet.",
                "probable_causes": [
                    "La ONT está registrada pero no tiene sesión de Internet activa.",
                    "Problema de configuración IP o sesión PPP/DHCP."
                ],
                "led_pattern_hint": "Power blanco fijo, PON blanco fijo, Internet apagado o sin parpadeo/tráfico.",
                "troubleshooting_steps": [
                    "Confirmar el estado del LED Internet (apagado, fijo o parpadeando).",
                    "Si está apagado, indicar que no hay conexión WAN activa; sugerir reinicio corto del equipo.",
                    "Probar navegación con un PC por cable en LAN1–LAN4.",
                    "Si tras el reinicio Internet sigue apagado, escalar a soporte de provisión/OLT."
                ]
            },
            {
                "id": "F6601P-P3",
                "customer_description": "Tengo WiFi encendido pero la señal no llega bien o se corta en algunas zonas.",
                "probable_causes": [
                    "Ubicación inadecuada del ONT.",
                    "Demasiados obstáculos o interferencias cerca del equipo."
                ],
                "led_pattern_hint": "WiFi blanco fijo o parpadeando, Internet con tráfico normal.",
                "troubleshooting_steps": [
                    "Explicar al cliente que la cobertura depende de ubicación, distancia y obstáculos.",
                    "Recomendar colocar el ONT lejos de objetos metálicos, espejos y electrodomésticos como microondas o teléfonos inalámbricos.",
                    "Sugerir ubicarlo en el mismo piso donde se usan los dispositivos, en una zona central y despejada, a una altura de ~1.2–1.5m.",
                    "Si la vivienda es grande, recomendar evaluación para soluciones adicionales (extensores/mesh)."
                ]
            },
            {
                "id": "F6601P-P4",
                "customer_description": "El teléfono conectado al puerto Phone no tiene tono.",
                "probable_causes": [
                    "Servicio de voz no registrado en el softswitch/IMS.",
                    "Cable telefónico desconectado o defecto en el terminal."
                ],
                "led_pattern_hint": "Phone apagado.",
                "troubleshooting_steps": [
                    "Pedir al cliente revisar que el teléfono esté correctamente conectado al puerto Phone con cable RJ-11.",
                    "Solicitar reinicio corto del ONT.",
                    "Si el LED Phone sigue apagado, indicar que la línea no se está registrando y escalar a soporte de voz/plataforma."
                ]
            }
        ],
        "diagnostic_guides": [
            {
                "id": "F6601P-GENERAL",
                "title": "Protocolo básico de diagnóstico para ZXHN F6601P",
                "steps": [
                    "Verificar que el LED Power esté blanco fijo.",
                    "Revisar LED PON: si no está blanco fijo, interpretar estado (registro en curso, actualización, sin registro).",
                    "Revisar LED LOS: si está rojo fijo o parpadeando, tratar como problema de fibra y evitar manipulación excesiva; si persiste, escalar a soporte de red óptica.",
                    "Si PON y LOS son normales, revisar LED Internet y probar conectividad con un dispositivo por cable.",
                    "Revisar estado de LEDs LAN1–LAN4 mientras se conecta un dispositivo.",
                    "Para problemas de WiFi, revisar ubicación del equipo y aplicar recomendaciones de instalación (ubicación central, evitar interferencias, misma planta).",
                    "Usar botón Reset solo como último recurso, explicando claramente el impacto al cliente."
                ]
            }
        ]
    },

    {
        "device_model": "SR1021F",
        "device_type": "router_mesh_wifi6",
        "manual_file": "Manual de Usuario- SR1021F.pdf",
        "description": "Router inalámbrico / nodo mesh con WiFi de doble banda (2.4GHz y 5GHz) y 2 interfaces Ethernet.",
        "key_features": [
            "Acceso inalámbrico Wi-Fi 2.4GHz y 5GHz",
            "2 puertos Ethernet",
            "Cobertura típica mayor a 50m en condiciones normales",
            "Diseñado para montaje sobre escritorio"
        ],
        "leds": [
            {
                "name": "LED principal de estado",
                "states": [
                    {
                        "value": "apagado",
                        "meaning": "El router está apagado o no funciona correctamente."
                    },
                    {
                        "value": "rojo encendido",
                        "meaning": "Se produjo una situación anormal; el router no pudo conectar a Internet."
                    },
                    {
                        "value": "verde encendido",
                        "meaning": "El router se instaló correctamente y funciona de forma normal."
                    }
                ],
                "manual_reference": "Sección indicador LEDs"
            }
        ],
        "buttons": [
            {
                "name": "Botón Fi (Mesh)",
                "description": "Se utiliza para establecer red en malla entre enrutador principal y sub-router.",
                "usage": [
                    "Acercar el sub-router al enrutador principal.",
                    "Presionar botón Fi en el router principal de 3 a 5 segundos hasta que el LED de Fi parpadee lentamente.",
                    "Presionar botón Fi en el sub-router más de 10 segundos hasta que el LED de Fi parpadee rápidamente.",
                    "La red mesh se establecerá automáticamente."
                ]
            },
            {
                "name": "Botón de reinicio",
                "description": "Reinicia o restaura el dispositivo.",
                "usage": [
                    "Presionar menos de 5 segundos para reiniciar el equipo sin perder configuración.",
                    "Presionar 5 segundos o más para restaurar valores de fábrica."
                ],
                "risk_warning": "Restaurar borra configuraciones personalizadas (SSID, contraseña, etc.)."
            }
        ],
        "typical_problems": [
            {
                "id": "SR1021F-P1",
                "customer_description": "El equipo tiene la luz roja y no tengo Internet.",
                "probable_causes": [
                    "El router no pudo establecer conexión a Internet (fallo en WAN o en el equipo principal si trabaja como sub-router)."
                ],
                "led_pattern_hint": "LED principal en rojo encendido.",
                "troubleshooting_steps": [
                    "Pedir al cliente que verifique si el router principal o módem está encendido y con servicio.",
                    "Revisar que el cable Ethernet hacia la WAN o puerto LAN del principal esté bien conectado.",
                    "Solicitar un reinicio corto (menos de 5 segundos en botón de reinicio).",
                    "Si el SR1021F actúa como sub-router mesh, rehacer el emparejamiento usando el botón Fi en ambos equipos.",
                    "Si el LED permanece rojo, escalar a soporte de nivel 2."
                ]
            },
            {
                "id": "SR1021F-P2",
                "customer_description": "La señal WiFi es muy débil o inestable en algunas habitaciones.",
                "probable_causes": [
                    "Demasiados obstáculos físicos entre router y dispositivos.",
                    "Ubicación inadecuada del equipo (esquinas, cerca de interferencias)."
                ],
                "led_pattern_hint": "LED en verde (router funcionando), pero mala experiencia de cobertura.",
                "troubleshooting_steps": [
                    "Confirmar que el SR1021F está montado sobre una superficie estable y visible.",
                    "Pedir al cliente que lo aleje de objetos metálicos, espejos y electrodomésticos que generen interferencia.",
                    "Recomendar ubicar el equipo en una zona más central de la vivienda para aprovechar el radio >50m.",
                    "Si hay dos unidades SR1021F, revisar que la red mesh esté correctamente establecida con el botón Fi."
                ]
            },
            {
                "id": "SR1021F-P3",
                "customer_description": "No recuerdo la contraseña WiFi o mis dispositivos no se conectan.",
                "probable_causes": [
                    "Dispositivos usando contraseña antigua.",
                    "Cambio accidental de SSID/contraseña."
                ],
                "led_pattern_hint": "LED verde encendido, pero dispositivos no autentican.",
                "troubleshooting_steps": [
                    "Indicar al cliente que revise el SSID y la contraseña configurados según las instrucciones del manual.",
                    "Si no logra acceder, sugerir usar un reinicio prolongado (más de 5 segundos) para restaurar valores de fábrica, explicando el impacto.",
                    "Una vez restaurado, acompañar para configurar de nuevo SSID y contraseña."
                ]
            }
        ],
        "diagnostic_guides": [
            {
                "id": "SR1021F-GENERAL",
                "title": "Protocolo básico de diagnóstico para SR1021F",
                "steps": [
                    "Verificar estado del LED principal (apagado, rojo, verde).",
                    "Si está apagado, revisar alimentación y cables de energía.",
                    "Si está rojo, revisar conectividad WAN/cable hacia el router principal y reiniciar.",
                    "Si el problema es de cobertura, revisar ubicación y obstáculos; reubicar equipo si es necesario.",
                    "Si forma parte de una red mesh, validar emparejamiento usando el botón Fi.",
                    "Como último recurso, considerar reset a valores de fábrica, advirtiendo impacto al cliente."
                ]
            }
        ]
    }
];


const INSTRUCCIONES_DIAGNOSTICO_EQUIPO = `
Eres ClaroFix, un AGENTE VIRTUAL DE SOPORTE TÉCNICO especializado en equipos de telecomunicaciones
(routers, ONT, cablemodems, decodificadores, CPE LTE/5G, routers mesh, etc.).

Tu objetivo es AYUDAR PASO A PASO a un cliente con POCO conocimiento de tecnología, usando SIEMPRE:

1) La información del equipo que ya fue reconocida desde una imagen: \`infoEquipo\`
   (por ejemplo: tipo de equipo, marca, modelo, nivel de confianza, etc.).
2) La base de conocimiento \`BASE_CONOCIMIENTO_EQUIPOS\`, que contiene:
   - descripción del equipo
   - LEDs y significado
   - botones y usos
   - problemas típicos (\`typical_problems\`)
   - guías de diagnóstico (\`diagnostic_guides\`).
3) Lo que el usuario te cuente sobre el problema (texto del chat) y, si está disponible,
   lo que se vea en la imagen (por ejemplo: LEDs encendidos, colores, mensajes de error en la pantalla, etc.).

--------------------------------------------------------
### CONTEXTO QUE RECIBES (NO LO REPITAS AL USUARIO)
--------------------------------------------------------

- \`infoEquipo\`: objeto JSON similar a:
  {
    "EQUIPMENT_TYPE": "...",
    "BRAND": "...",
    "MODEL": "...",
    "MATCH_CONFIDENCE": 0.9,
    ...
  }

- \`BASE_CONOCIMIENTO_EQUIPOS\`: arreglo JSON con la información de varios equipos,
  incluyendo campos como \`device_model\`, \`device_type\`, \`typical_problems\`,
  \`diagnostic_guides\`, etc.

Debes usar \`infoEquipo\` para encontrar en \`BASE_CONOCIMIENTO_EQUIPOS\` el equipo
que mejor coincida (por ejemplo, comparando \`MODEL\` con \`device_model\`).
Si no encuentras una coincidencia exacta, busca la más cercana por marca/modelo.
Si aun así no encuentras nada, dilo de forma honesta y responde con consejos GENÉRICOS,
pero sigue siendo amable y claro.

--------------------------------------------------------
### OBJETIVO PRINCIPAL
--------------------------------------------------------

Con la información de \`infoEquipo\`, la base de conocimiento y lo que describa el cliente:

- Identifica (si es posible) cuál de los \`typical_problems\` del equipo se parece más
  al problema del cliente (por descripción y/o por patrón de LEDs).
- Si la imagen da pistas adicionales (por ejemplo un LED LOS rojo, un LED Internet apagado,
  LED principal en rojo, etc.), úsalas para seleccionar el problema más probable.
- Si el problema no está claro, HAZ PREGUNTAS SIMPLES para aclarar la situación
  (por ejemplo: “¿Qué luces ves encendidas y de qué color?”, “¿Puedes decirme si la luz LOS está roja fija o parpadeando?”).
- Una vez tengas un problema probable, guía al cliente con un PASO A PASO basado en
  \`troubleshooting_steps\` y \`diagnostic_guides\` del equipo que corresponda.

--------------------------------------------------------
### ESTILO DE CONVERSACIÓN CON EL CLIENTE
--------------------------------------------------------

- Asume que el cliente NO es técnico.
- Usa frases cortas, claras y en segunda persona (“tú”).
- No uses siglas técnicas sin explicarlas brevemente (por ejemplo, si dices “ONT”,
  aclara “el equipo de fibra que tienes en tu casa”).
- Habla con tono empático y tranquilo, por ejemplo:
  - “Tranquilo, vamos a revisarlo paso a paso.”
  - “Te acompaño en todo el proceso.”

- Da instrucciones en formato de lista de pasos numerados:
  1. Paso 1…
  2. Paso 2…
  3. Paso 3…

- Después de 2 o 3 pasos importantes, PIDE SIEMPRE CONFIRMACIÓN al cliente:
  “Cuando lo tengas, dime cómo te fue para continuar.”

--------------------------------------------------------
### CÓMO USAR LA BASE DE CONOCIMIENTO
--------------------------------------------------------

1) **Elegir el equipo**:
   - Busca en \`BASE_CONOCIMIENTO_EQUIPOS\` el registro cuyo \`device_model\`
     coincida mejor con \`infoEquipo.MODEL\`.
   - Si hay varias coincidencias, elige la más similar.
   - Incluye en tu respuesta el nombre del modelo para que el cliente sepa qué equipo estás trabajando.

2) **Intentar identificar el problema**:
   - Compara lo que el cliente diga (por ejemplo: “tengo WiFi pero no cargan las páginas”,
     “la luz LOS está roja”, “la luz está en rojo”, “no tengo tono en el teléfono”)
     contra la lista \`typical_problems[]\` del equipo.
   - Usa también las pistas de \`led_pattern_hint\` para preguntar por LEDs concretos
     (Power, Internet, LOS, PON, WiFi, etc.).
   - Si la descripción del cliente encaja claramente con un \`typical_problems.id\`,
     trabaja con ese problema.
   - Si no encaja con ninguno, aplica primero la \`diagnostic_guides[]\` general del equipo
     y ve descartando causas con preguntas sencillas.

3) **Dar el paso a paso de solución**:
   - Usa los \`troubleshooting_steps\` del problema elegido y las \`diagnostic_guides\`
     como base.
   - Adapta el lenguaje para que sea muy sencillo, sin copiar literalmente texto extenso del manual.
   - Ordena los pasos de forma lógica: primero verificaciones simples (ver LEDs, revisar cables),
     luego acciones como reiniciar, y finalmente escalar el caso si es necesario.
   - Si un paso implica riesgo (por ejemplo un reset de fábrica),
     EXPLICA SIEMPRE el riesgo de forma clara antes de pedir que lo haga.

4) **Si el problema parece externo (red del operador)**:
   - Explícalo al cliente con frases claras (por ejemplo: “Parece que el problema está en la red externa, no en tu casa”).
   - Indica que se debe escalar a soporte técnico o generar una visita técnica,
     según lo que indiquen los \`troubleshooting_steps\` y \`diagnostic_guides\`.

--------------------------------------------------------
### CUANDO NO TENGAS TODA LA INFORMACIÓN
--------------------------------------------------------

- Si la imagen del equipo NO es suficiente para ver el estado de LEDs o cables,
  pide al cliente que te describa lo que ve:
  - “¿Qué luces ves encendidas en el equipo y de qué color?”
  - “¿La luz que dice LOS está apagada, roja fija o parpadeando?”
  - “¿El cable que va al módem o a la pared está bien conectado?”

- Si después de algunas preguntas sigues sin poder identificar el problema exacto:
  - Dilo de forma honesta.
  - Ofrece una guía general de revisión (energía, cables, reinicio corto).
  - Sugiere escalar a soporte técnico con visita si la base de conocimiento indica que es probable
    un problema de red externa o de fibra.

--------------------------------------------------------
### FORMATO DE RESPUESTA
--------------------------------------------------------

Responde SIEMPRE en un objeto JSON con esta estructura:

{
  "reply": "<mensaje para el cliente con explicación + pasos numerados>",
  "equipoDetectado": {
    "device_model": "<modelo según BASE_CONOCIMIENTO_EQUIPOS o null>",
    "device_type": "<tipo de equipo o null>"
  },
  "problemaBaseConocimientoId": "<id del typical_problems elegido, por ejemplo 'INF601-P1', o null si no aplica>",
  "requiereMasInfoDelCliente": true | false
}

- En \`reply\` NO incluyas el JSON ni explicaciones técnicas internas; solo el texto
  que leerá el cliente, con un tono cercano y pasos claros.
- Usa máximo 6–8 pasos a la vez. Si hay más, corta la solución en fases y pide
  confirmación antes de seguir.
`;

// Servicio para ver y limpiar el historial del agente de soporte
app.post("/api/agente-soporte/limpiar-historial", (req, res) => {
    // 1) Imprimir en consola el historial actual
    console.log("HISTORIAL_CHATS ANTES DE LIMPIAR:", JSON.stringify(HISTORIAL_CHATS, null, 2));

    const cantidadAntes = HISTORIAL_CHATS.length;

    // 2) Vaciar el array (como es const, cambiamos su contenido, no la referencia)
    HISTORIAL_CHATS.length = 0;

    // 3) Responder al cliente
    return res.json({
        mensaje: "Historial limpiado correctamente",
        cantidadEliminada: cantidadAntes,
    });
});