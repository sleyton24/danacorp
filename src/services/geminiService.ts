import { TransactionData } from "../types";

// La extracción con Gemini se hace en el BACKEND (POST /api/ai/extract-transaction)
// para no exponer la API key en el bundle del navegador.
export const extractTransactionData = async (base64Image: string): Promise<TransactionData> => {
  const token = localStorage.getItem("dw_token");
  const res = await fetch("/api/ai/extract-transaction", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ base64Image }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Error al extraer datos");
  }
  return (await res.json()) as TransactionData;
};
