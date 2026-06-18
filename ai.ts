// Extracción de datos de transacciones desde una imagen (software legacy) con Gemini.
// CORRE EN EL BACKEND: la API key (GEMINI_API_KEY) nunca llega al navegador.
// @google/genai se importa de forma diferida (lazy) para no penalizar el arranque
// del servidor ni los tests (es una dependencia pesada que solo se usa aquí).
export async function extractTransactionData(base64Image: string): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    throw new Error('GEMINI_API_KEY no configurada en el servidor');
  }
  const { GoogleGenAI, Type } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    Analyze this image which is a screenshot of a legacy real estate software (Microsoft Works style).
    Extract the data into a structured JSON format.

    Specific mappings:
    - 'OBRA' -> meta.obra
    - 'COMPRADOR' -> comprador.nombre
    - 'RUT' -> comprador.rut
    - 'F.1' through 'F.17' (dates and amounts) -> pagos array.
    - 'P.VENTA' -> financiero.precioVenta
    - 'DP UF' -> financiero.pie
    - 'TOTAL ESCRIT' -> financiero.totalEscritura
    - 'OBSERV' -> observaciones (The entire text block at the bottom)

    If a field is empty in the image (like BX or BT), return an empty string.
    Ensure numeric values retain their formatting (e.g., "4,565.00").

    The output must correspond to the following structure exactly.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/png', data: base64Image } },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          meta: { type: Type.OBJECT, properties: {
            obra: { type: Type.STRING }, fechaActual: { type: Type.STRING }, folio: { type: Type.STRING },
          } },
          comprador: { type: Type.OBJECT, properties: {
            nombre: { type: Type.STRING }, rut: { type: Type.STRING }, ciudad: { type: Type.STRING },
            comuna: { type: Type.STRING }, telefono: { type: Type.STRING }, email: { type: Type.STRING },
          } },
          propiedad: { type: Type.OBJECT, properties: {
            depto: { type: Type.STRING }, bodega: { type: Type.STRING },
            estacionamiento: { type: Type.STRING }, caracteristica: { type: Type.STRING },
          } },
          financiero: { type: Type.OBJECT, properties: {
            precioVenta: { type: Type.STRING }, precioLista: { type: Type.STRING }, pie: { type: Type.STRING },
            reserva: { type: Type.STRING }, totalEscritura: { type: Type.STRING }, totalPagado: { type: Type.STRING },
            saldoPorPagar: { type: Type.STRING }, bonoDescuento: { type: Type.STRING },
          } },
          fechas: { type: Type.OBJECT, properties: {
            fechaEntrega: { type: Type.STRING }, fechaEscritura: { type: Type.STRING },
            notaria: { type: Type.STRING }, banco: { type: Type.STRING }, tipoOperacion: { type: Type.STRING },
          } },
          pagos: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
            id: { type: Type.STRING }, date: { type: Type.STRING }, amount: { type: Type.STRING },
          } } },
          observaciones: { type: Type.STRING },
        },
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error('No data returned from Gemini');
  return JSON.parse(text);
}
