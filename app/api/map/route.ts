import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// The actual GrowEasy CRM fields (from the assignment spec).
const CRM_FIELDS = [
  "created_at",
  "name",
  "email",
  "country_code",
  "mobile_without_country_code",
  "company",
  "city",
  "state",
  "country",
  "lead_owner",
  "crm_status",
  "crm_note",
  "data_source",
  "possession_time",
  "description",
];

export async function POST(req: Request) {
  try {
    const csvData = await req.json();

    if (!Array.isArray(csvData) || csvData.length === 0) {
      return NextResponse.json(
        { success: false, error: "No CSV data received" },
        { status: 400 }
      );
    }

    const csvColumns = Object.keys(csvData[0]);
    const sampleRows = csvData.slice(0, 3);

    const prompt = `You are mapping columns from an uploaded CSV (which could be a Facebook Lead Export, Google Ads export, a real estate CRM export, a sales report, or a manually made spreadsheet) onto a fixed set of CRM fields.

CRM fields to fill: ${JSON.stringify(CRM_FIELDS)}

Field meanings:
- created_at: when the lead was created/submitted
- name: the lead's full name
- email: primary email address
- country_code: phone country code (e.g. +91)
- mobile_without_country_code: phone number without the country code
- company: company name
- city, state, country: location fields
- lead_owner: person/agent responsible for this lead
- crm_status: the lead's current status/stage in a sales pipeline (look for columns like "status", "stage", "lead status")
- crm_note: any remarks, notes, or comments about the lead
- data_source: where the lead came from (e.g. a campaign name, ad source, or project name)
- possession_time: for real estate leads, expected property possession/handover time
- description: any other freeform description of the lead

CSV columns available: ${JSON.stringify(csvColumns)}

Here are a few sample rows from the CSV for context:
${JSON.stringify(sampleRows, null, 2)}

For each CRM field, choose the single CSV column name that best matches it, based on both the column name and the sample values.
If no reasonable match exists for a CRM field, use the string "Not Found".

Respond with ONLY a raw JSON object (no markdown, no code fences, no explanation) mapping every CRM field listed above to a CSV column name or "Not Found".`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const rawText = response.text ?? "";

    console.log("Gemini raw response:", rawText);

    if (!rawText) {
      return NextResponse.json(
        { success: false, error: "Empty response from Gemini" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      mapping: rawText,
    });
  } catch (err) {
    console.error("Mapping route error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to generate mapping" },
      { status: 500 }
    );
  }
}