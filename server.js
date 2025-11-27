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
Tu objetivo es ayudar a clientes con problemas en sus equipos de red (routers, ONT, decodificadores, etc.)
usando la información de las herramientas y de la base de datos de la compañía.

REGLAS GENERALES
- Habla SIEMPRE en español, de forma clara, cercana y profesional.
- Usa frases cortas y pasos numerados cuando des instrucciones técnicas.
- Nunca inventes datos de cliente, equipos o problemas: usa siempre las herramientas disponibles.
- Si una herramienta devuelve un error o datos vacíos, explícalo de forma sencilla al cliente y ofrece alternativas.
- Evita tecnicismos complejos; si debes usarlos, explícalos en palabras simples.

FLUJO PRINCIPAL (RESUMIDO)

1) IDENTIFICACIÓN DEL CLIENTE
- Si aún no tienes datos del cliente, preséntate brevemente y pide:
  - Documento de identidad O número de cuenta (solo uno a la vez).
- Con ese dato, solicita la herramienta get_cliente_por_documento.

2) DATOS DEL CLIENTE Y EQUIPOS
- Si get_cliente_por_documento devuelve datos:
  - Saluda al cliente por su nombre.
  - Llama a get_equipos_cliente para saber qué equipos tiene.
  - Si hay varios equipos, pide aclarar con cuál tiene el problema.
  - Indica que se puede usar una foto del equipo, pero la foto la manejará otro servicio interno.

3) PROBLEMA DEL EQUIPO
- Pregunta de forma abierta: “¿Qué problema notas exactamente?”
- Resume el síntoma en una frase corta.
- Llama a get_problemas_frecuentes con el modelo de equipo y el síntoma.

4) PASOS DE SOLUCIÓN
- Da instrucciones paso a paso, no todas a la vez.
- Después de 1–2 pasos, pregunta si se solucionó.
- Si tras varios pasos no se resuelve, sugiere escalar a un agente humano y resume lo ya intentado.

ESTILO
- Empieza con un saludo breve.
- Mantén un tono empático.
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
            description: "Documento de identidad o número de cuenta del cliente",
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
    documento: "1026259098", // una de las cédulas que pediste
    segmento: "Residencial",
  },
  {
    idCliente: "cli-2",
    nombre: "Juan Rodríguez",
    documento: "51965155", // otra de las cédulas que pediste
    segmento: "Residencial",
  },
  {
    idCliente: "cli-3",
    nombre: "María Fernanda López",
    documento: "20067413", // otra de las cédulas que pediste
    segmento: "Residencial",
  },
  {
    idCliente: "cli-4",
    nombre: "Carlos Andrés Gómez",
    documento: "79254794", // otra de las cédulas que pediste
    segmento: "Residencial",
  },
  {
    idCliente: "cli-5",
    nombre: "Ana Lucía Martínez",
    documento: "88812345",
    segmento: "Residencial",
  },
  {
    idCliente: "cli-6",
    nombre: "Luis Felipe Rojas",
    documento: "1032456789",
    segmento: "Residencial",
  },
  {
    idCliente: "cli-7",
    nombre: "Sofía Ramírez",
    documento: "1098765432",
    segmento: "Residencial",
  },
  {
    idCliente: "cli-8",
    nombre: "Miguel Ángel Torres",
    documento: "79543210",
    segmento: "PYME",
  },
  {
    idCliente: "cli-9",
    nombre: "Laura Daniela Castillo",
    documento: "1122334455",
    segmento: "PYME",
  },
  {
    idCliente: "cli-10",
    nombre: "Jorge Enrique Hernández",
    documento: "99887766",
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

app.post("/api/agente-soporte", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "Debes enviar un arreglo 'messages' con los mensajes del chat.",
      });
    }

    // 1) Primera llamada al modelo, con tools
    const chatMessages = [
      { role: "system", content: INSTRUCCIONES_SOPORTE },
      ...messages,
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
        toolResult = await getClientePorDocumento(args.identificador);
      } else if (functionName === "get_equipos_cliente") {
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
      return res.json({ reply: finalText });
    }

    // 3) Si NO hay tool calls, devolvemos directamente el contenido
    return res.json({ reply: responseMessage.content });
  } catch (err) {
    console.error("Error en /api/agente-soporte:", err);
    return res.status(500).json({
      error: "Error interno en el agente de soporte",
    });
  }
});

/* =========================================================
   7) ARRANQUE DEL SERVICIO
   ========================================================= */

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servicio REST escuchando en http://localhost:${port}`);
});