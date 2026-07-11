import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const crmData = await req.json();

  console.log("CRM Data Received:");
  console.table(crmData.slice(0, 5));

  return NextResponse.json({
    success: true,
    imported: crmData.length,
  });
}