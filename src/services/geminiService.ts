import { GoogleGenAI, Type } from "@google/genai";
import { TransactionData } from "../types";

export const extractTransactionData = async (base64Image: string): Promise<TransactionData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

  try {
    // Using gemini-3-flash-preview as per task type guidelines (Basic Text/QA style multimodal)
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image,
            },
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            meta: {
              type: Type.OBJECT,
              properties: {
                obra: { type: Type.STRING },
                fechaActual: { type: Type.STRING },
                folio: { type: Type.STRING },
              }
            },
            comprador: {
              type: Type.OBJECT,
              properties: {
                nombre: { type: Type.STRING },
                rut: { type: Type.STRING },
                ciudad: { type: Type.STRING },
                comuna: { type: Type.STRING },
                telefono: { type: Type.STRING },
                email: { type: Type.STRING },
              }
            },
            propiedad: {
              type: Type.OBJECT,
              properties: {
                depto: { type: Type.STRING },
                bodega: { type: Type.STRING },
                estacionamiento: { type: Type.STRING },
                caracteristica: { type: Type.STRING },
              }
            },
            financiero: {
              type: Type.OBJECT,
              properties: {
                precioVenta: { type: Type.STRING },
                precioLista: { type: Type.STRING },
                pie: { type: Type.STRING },
                reserva: { type: Type.STRING },
                totalEscritura: { type: Type.STRING },
                totalPagado: { type: Type.STRING },
                saldoPorPagar: { type: Type.STRING },
                bonoDescuento: { type: Type.STRING },
              }
            },
            fechas: {
              type: Type.OBJECT,
              properties: {
                fechaEntrega: { type: Type.STRING },
                fechaEscritura: { type: Type.STRING },
                notaria: { type: Type.STRING },
                banco: { type: Type.STRING },
                tipoOperacion: { type: Type.STRING },
              }
            },
            pagos: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  date: { type: Type.STRING },
                  amount: { type: Type.STRING },
                }
              }
            },
            observaciones: { type: Type.STRING },
          }
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");
    return JSON.parse(text) as TransactionData;

  } catch (error) {
    console.error("Error extracting data:",