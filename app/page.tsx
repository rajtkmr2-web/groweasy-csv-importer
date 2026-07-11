"use client";

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

type CsvRow = Record<string, string>;

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [csvData, setCsvData] = useState<CsvRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState("");

  // Step 5: AI mapping generation state
  const [isGeneratingMapping, setIsGeneratingMapping] = useState(false);

  // Step 8: actual CRM import state
  const [isSendingToCrm, setIsSendingToCrm] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importError, setImportError] = useState("");

  // Toast notification
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (importedCount === null && !importError) return;

    setShowToast(true);
    const timer = setTimeout(() => setShowToast(false), 4000);
    return () => clearTimeout(timer);
  }, [importedCount, importError]);

  // AI Mapping
  const [mapping, setMapping] =
    useState<Record<string, string> | null>(null);
  const [aiSuggestedMapping, setAiSuggestedMapping] =
    useState<Record<string, string> | null>(null);

  // Step 7: transformed data ready for the CRM
  const [crmData, setCrmData] = useState<Record<string, string>[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);

  const resetState = () => {
    setCsvData([]);
    setError("");
    setImportedCount(null);
    setImportError("");
    setMapping(null);
    setAiSuggestedMapping(null);
    setCrmData([]);
    setSkippedCount(0);
  };

  const handleMappingChange = (crmField: string, newCsvColumn: string) => {
    setMapping((prev) => ({
      ...(prev ?? {}),
      [crmField]: newCsvColumn,
    }));
  };

  // Allowed enum values per the assignment spec
  const ALLOWED_STATUS = [
    "GOOD_LEAD_FOLLOW_UP",
    "DID_NOT_CONNECT",
    "BAD_LEAD",
    "SALE_DONE",
  ];

  const ALLOWED_SOURCE = [
    "leads_on_demand",
    "meridian_tower",
    "eden_park",
    "varah_swamy",
    "sarjapur_plots",
  ];

  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const PHONE_REGEX = /\+?\d[\d\s.\-]{6,}\d/g;

  // Best-effort keyword match against a fixed enum; returns "" if nothing fits
  // Generic words that are too common/ambiguous to safely match on their own
  const STOPWORDS = new Set(["not", "did", "the", "and", "for", "lead"]);

  const matchEnum = (value: string, allowed: string[]): string => {
    if (!value) return "";
    const v = value.toLowerCase();

    // Check specific synonyms first (most specific / negative patterns
    // before generic positive ones, to avoid e.g. "not interested"
    // matching the "interested" pattern for GOOD_LEAD_FOLLOW_UP).
    if (allowed === ALLOWED_STATUS) {
      if (/(not interested|junk|invalid|spam|bad lead)/.test(v))
        return "BAD_LEAD";
      if (/(no answer|unreachable|not reachable|busy|no response|did not connect)/.test(v))
        return "DID_NOT_CONNECT";
      if (/(sold|closed|won|deal done|converted|sale done)/.test(v))
        return "SALE_DONE";
      if (/(interested|follow|callback|call back)/.test(v))
        return "GOOD_LEAD_FOLLOW_UP";
    }

    // Fallback: match on individual words from the enum name itself,
    // skipping generic/ambiguous words that cause false positives.
    for (const option of allowed) {
      const words = option
        .toLowerCase()
        .split("_")
        .filter((w) => w.length > 2 && !STOPWORDS.has(w));
      if (words.some((w) => v.includes(w))) {
        return option;
      }
    }

    return "";
  };

  const isValidDate = (value: string) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return !Number.isNaN(t);
  };

  // Step 6: Transform CSV rows into CRM-shaped rows using the mapping,
  // applying GrowEasy's field rules (enum validation, multi-value handling,
  // date validation, and skipping records with no email/mobile).
  const transformData = () => {
    if (!mapping) return { records: [], skipped: 0 };

    let skipped = 0;

    const records = csvData
      .map((row) => {
        const newRow: Record<string, string> = {};

        Object.entries(mapping).forEach(([crmField, csvColumn]) => {
          if (csvColumn?.startsWith("__combine__:")) {
            const parts = csvColumn.replace("__combine__:", "").split("+");
            newRow[crmField] = parts
              .map((col) => row[col] || "")
              .filter(Boolean)
              .join(" ");
          } else {
            newRow[crmField] =
              csvColumn && csvColumn !== "Not Found" ? row[csvColumn] || "" : "";
          }
        });

        const extraNotes: string[] = [];

        // Multiple emails: keep first, push the rest into crm_note
        const emailMatches = newRow.email?.match(EMAIL_REGEX) || [];
        const firstEmail = emailMatches[0];
        if (emailMatches.length > 1 && firstEmail) {
          newRow.email = firstEmail;
          extraNotes.push(`Additional emails: ${emailMatches.slice(1).join(", ")}`);
        } else if (emailMatches.length === 1 && firstEmail) {
          newRow.email = firstEmail;
        }

        // Multiple phone numbers: keep first, push the rest into crm_note
        const phoneMatches =
          newRow.mobile_without_country_code?.match(PHONE_REGEX) || [];
        const firstPhone = phoneMatches[0];

        const extractCountryCode = (raw: string) => {
          const match = raw.trim().match(/^\+(\d{1,3})[\s.-]/);
          if (match && !newRow.country_code) {
            newRow.country_code = `+${match[1]}`;
          }
        };

        if (phoneMatches.length > 1 && firstPhone) {
          extractCountryCode(firstPhone);
          newRow.mobile_without_country_code = firstPhone
            .replace(/\D/g, "")
            .slice(-10);
          extraNotes.push(
            `Additional numbers: ${phoneMatches.slice(1).join(", ")}`
          );
        } else if (phoneMatches.length === 1 && firstPhone) {
          extractCountryCode(firstPhone);
          newRow.mobile_without_country_code = firstPhone
            .replace(/\D/g, "")
            .slice(-10);
        }

        // crm_status must be one of the 4 allowed values, else blank
        const normalizedStatus = matchEnum(newRow.crm_status, ALLOWED_STATUS);
        newRow.crm_status = normalizedStatus;

        // data_source must be one of the 5 allowed values, else blank
        const normalizedSource = matchEnum(newRow.data_source, ALLOWED_SOURCE);
        newRow.data_source = normalizedSource;

        // created_at must be parseable by `new Date(...)`
        if (!isValidDate(newRow.created_at)) {
          if (newRow.created_at) {
            extraNotes.push(`Original date value: ${newRow.created_at}`);
          }
          newRow.created_at = "";
        }

        // Merge any extracted extra info into crm_note
        if (extraNotes.length) {
          newRow.crm_note = [newRow.crm_note, ...extraNotes]
            .filter(Boolean)
            .join(" | ");
        }

        return newRow;
      })
      // Skip rule: a record needs at least an email or a mobile number
      .filter((row) => {
        const keep = Boolean(row.email || row.mobile_without_country_code);
        if (!keep) skipped += 1;
        return keep;
      });

    return { records, skipped };
  };

  // Step 7: keep crmData in sync whenever the mapping (or CSV) changes,
  // so edits to the dropdowns immediately update the CRM Preview table
  useEffect(() => {
    if (!mapping) {
      setCrmData([]);
      setSkippedCount(0);
      return;
    }

    const { records, skipped } = transformData();
    setCrmData(records);
    setSkippedCount(skipped);
  }, [mapping, csvData]);

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }

    resetState();
    setFileName(file.name);
    setIsParsing(true);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,

      complete: (results) => {
        setIsParsing(false);

        if (results.errors.length > 0) {
          setError(
            `Parsed with ${results.errors.length} issue(s).`
          );
        }

        if (!results.data.length) {
          setError("CSV is empty.");
          return;
        }

        setCsvData(results.data);
      },

      error: (err) => {
        setIsParsing(false);
        setError(err.message);
      },
    });
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) return;

    processFile(file);
    event.target.value = "";
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleGenerateMapping = async () => {
    if (!csvData.length) return;

    setIsGeneratingMapping(true);
    setError("");

    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(csvData),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || "Mapping generation failed");
      }

      if (result.mapping) {
        const cleanJson = result.mapping
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        const parsedMapping = JSON.parse(cleanJson);

        // If no single "name" column was found, look for common
        // first-name/last-name column pairs and auto-combine them.
        if (!parsedMapping.name || parsedMapping.name === "Not Found") {
          const firstNameCol = allColumns.find((c) =>
            /^(first|given)[\s_-]?name$/i.test(c.trim())
          );
          const lastNameCol = allColumns.find((c) =>
            /^(last|sur|family)[\s_-]?name$/i.test(c.trim())
          );

          if (firstNameCol && lastNameCol) {
            parsedMapping.name = `__combine__:${firstNameCol}+${lastNameCol}`;
          } else if (firstNameCol) {
            parsedMapping.name = firstNameCol;
          }
        }

        // If no phone column was found, look for common phone-like columns.
        if (
          !parsedMapping.mobile_without_country_code ||
          parsedMapping.mobile_without_country_code === "Not Found"
        ) {
          const phoneCol = allColumns.find((c) =>
            /(phone|mobile|contact\s?number|whatsapp|cell)/i.test(c.trim())
          );
          if (phoneCol) {
            parsedMapping.mobile_without_country_code = phoneCol;
          }
        }

        setMapping(parsedMapping);
        setAiSuggestedMapping(parsedMapping);
      }
    } catch (err) {
      console.error(err);
      setError("Mapping generation failed. Please try again.");
    } finally {
      setIsGeneratingMapping(false);
    }
  };

  // Step 8: send the transformed CRM data to the backend
  const handleDownloadCsv = () => {
    if (!crmData.length) return;

    const csv = Papa.unparse(crmData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "crm-mapped-data.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };
  const handleSendToCrm = async () => {
    if (!crmData.length) return;

    setIsSendingToCrm(true);
    setImportedCount(null);
    setImportError("");

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(crmData),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || "Import failed");
      }

      setImportedCount(result.imported ?? crmData.length);
    } catch (err) {
      console.error(err);
      setImportError("Import to CRM failed. Please try again.");
    } finally {
      setIsSendingToCrm(false);
    }
  };

  const handleClear = () => {
    setFileName("");
    resetState();
  };

  const columns =
    csvData.length > 0
      ? Object.keys(csvData[0]).slice(0, 10)
      : [];

  // Full column list (unsliced) used for the mapping dropdown options
  const allColumns =
    csvData.length > 0 ? Object.keys(csvData[0]) : [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex justify-center py-10 px-4">
      <div className="bg-white w-full max-w-7xl rounded-2xl shadow-xl p-4 sm:p-8">

        <div className="flex flex-col items-center">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-purple-300 mb-4">
            🤖
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold text-center bg-gradient-to-r from-fuchsia-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
            AI CSV Importer
          </h1>
        </div>

        <p className="text-center text-gray-500 mt-3 text-lg">
          Upload any CSV file and preview it before importing.
        </p>

        {(() => {
          const steps = [
            { label: "Upload", done: Boolean(fileName) },
            { label: "Preview", done: csvData.length > 0 },
            { label: "AI Mapping", done: Boolean(mapping) },
            { label: "CRM Preview", done: crmData.length > 0 },
            { label: "Import", done: importedCount !== null },
          ];

          return (
            <div className="flex items-center justify-center gap-1 sm:gap-2 mt-8 mb-2 overflow-x-auto px-2">
              {steps.map((step, i) => (
                <div key={step.label} className="flex items-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                        step.done
                          ? "bg-gradient-to-br from-fuchsia-500 to-indigo-600 border-transparent text-white shadow-md shadow-purple-300"
                          : "bg-white border-gray-300 text-gray-400"
                      }`}
                    >
                      {step.done ? "✓" : i + 1}
                    </div>
                    <span
                      className={`text-[11px] sm:text-xs whitespace-nowrap ${
                        step.done
                          ? "text-purple-700 font-semibold"
                          : "text-gray-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>

                  {i < steps.length - 1 && (
                    <div
                      className={`w-6 sm:w-12 h-0.5 mx-1 mb-4 ${
                        step.done
                          ? "bg-gradient-to-r from-fuchsia-500 to-indigo-600"
                          : "bg-gray-300"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`text-center mt-8 border-2 border-dashed rounded-2xl py-10 px-4 transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-gray-50"
          }`}
        >

          <p className="text-gray-500 mb-4">
            {isDragging
              ? "Drop your CSV file here"
              : "Drag & drop a CSV file here, or"}
          </p>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isParsing}
            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-8 py-3 rounded-lg font-semibold shadow-md shadow-indigo-200 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {isParsing
              ? "Reading file..."
              : "Choose CSV File"}
          </button>

          {fileName && (
            <>
              <p className="mt-5 text-green-600 font-semibold">
                📄 Selected File: {fileName}
              </p>

              <p className="mt-2 text-gray-700">
                Loaded <b>{csvData.length}</b> records
              </p>
            </>
          )}

          {error && (
            <p className="text-red-600 mt-3">{error}</p>
          )}

        </div>

        {csvData.length > 0 && (
          <>

            <div className="flex flex-wrap gap-2 justify-between items-center mt-10 mb-5 animate-fade-in">

              <h2 className="text-2xl font-bold text-gray-900">
                CSV Preview
              </h2>

              <button
                onClick={handleClear}
                className="underline text-gray-500"
              >
                Clear
              </button>

            </div>

            <div className="overflow-auto rounded-xl border shadow max-h-96">

              <table className="min-w-full">

                <thead className="sticky top-0 z-10">

                  <tr>

                    {columns.map((column) => (

                      <th
                        key={column}
                        className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-3 text-left whitespace-nowrap"
                      >
                        {column}
                      </th>

                    ))}

                  </tr>

                </thead>

                <tbody>

                  {csvData
                    .slice(0, 50)
                    .map((row, index) => (

                      <tr
                        key={index}
                        className="hover:bg-gray-50"
                      >

                        {columns.map((column) => (

                          <td
                            key={column}
                            className="border p-3 whitespace-nowrap text-gray-900"
                          >
                            {row[column]}
                          </td>

                        ))}

                      </tr>

                    ))}

                </tbody>

              </table>

            </div>

            <div className="flex flex-wrap gap-3 justify-between items-center mt-5">

              <p className="text-gray-500 text-sm">
                Showing {Math.min(csvData.length, 50)} of {csvData.length}{" "}
                rows (scroll for more) and first 10 columns.
              </p>

              <button
                onClick={handleGenerateMapping}
                disabled={isGeneratingMapping}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-8 py-3 rounded-lg font-semibold shadow-md shadow-emerald-200 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-all"
              >
                {isGeneratingMapping && (
                  <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {isGeneratingMapping
                  ? "Generating mapping..."
                  : "🤖 Generate AI Mapping"}
              </button>

            </div>

            {/* AI Mapping */}

            {mapping && (

              <div className="mt-10 animate-fade-in">

                <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">
                    🤖 AI Field Mapping
                  </h2>
                  <p className="text-sm text-gray-500">
                    Review the AI's suggestions and adjust any field below.
                  </p>
                </div>

                {Object.values(mapping).some(
                  (v) => !v || v === "Not Found"
                ) && (
                  <p className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠️ Some fields couldn't be confidently matched — please
                    select the correct CSV column manually.
                  </p>
                )}

                <div className="overflow-hidden rounded-xl border shadow">

                  <table className="w-full">

                    <thead className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white">

                      <tr>

                        <th className="p-3 text-left">
                          GrowEasy Field
                        </th>

                        <th className="p-3 text-left">
                          CSV Column
                        </th>

                        <th className="p-3 text-left">
                          Status
                        </th>

                      </tr>

                    </thead>

                    <tbody>

                      {Object.entries(mapping).map(
                        ([crmField, csvField]) => {
                          const aiValue = aiSuggestedMapping?.[crmField];
                          const isEdited = csvField !== aiValue;
                          const isUnmapped =
                            !csvField || csvField === "Not Found";
                          const isCombined =
                            csvField?.startsWith("__combine__:");
                          const combinedLabel = isCombined
                            ? csvField
                                .replace("__combine__:", "")
                                .split("+")
                                .join(" + ")
                            : "";

                          return (
                            <tr
                              key={crmField}
                              className="border-t hover:bg-gray-50"
                            >

                              <td className="p-3 font-semibold text-gray-900">
                                {crmField}
                              </td>

                              <td className="p-3">
                                <select
                                  value={
                                    isUnmapped ? "" : csvField
                                  }
                                  onChange={(e) =>
                                    handleMappingChange(
                                      crmField,
                                      e.target.value
                                    )
                                  }
                                  className={`w-full max-w-xs rounded-lg border px-3 py-2 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    isUnmapped
                                      ? "border-amber-300"
                                      : "border-gray-300"
                                  }`}
                                >
                                  <option value="">
                                    -- Not mapped --
                                  </option>
                                  {isCombined && (
                                    <option value={csvField}>
                                      {combinedLabel} (auto-combined)
                                    </option>
                                  )}
                                  {allColumns.map((col) => (
                                    <option key={col} value={col}>
                                      {col}
                                    </option>
                                  ))}
                                </select>
                              </td>

                              <td className="p-3 text-sm">
                                {isUnmapped ? (
                                  <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 font-medium px-2.5 py-1 rounded-full text-xs">
                                    ⚠️ Needs review
                                  </span>
                                ) : isCombined ? (
                                  <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 font-medium px-2.5 py-1 rounded-full text-xs">
                                    🔗 Auto-combined
                                  </span>
                                ) : isEdited ? (
                                  <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 font-medium px-2.5 py-1 rounded-full text-xs">
                                    ✏️ Edited
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 font-medium px-2.5 py-1 rounded-full text-xs">
                                    ✨ AI suggested
                                  </span>
                                )}
                              </td>

                            </tr>
                          );
                        }
                      )}

                    </tbody>

                  </table>

                </div>

              </div>

            )}

            {/* CRM Preview */}

            {crmData.length > 0 && (

              <div className="mt-10 animate-fade-in">

                <h2 className="text-2xl font-bold mb-4 text-gray-900">
                  ✅ CRM Preview
                </h2>

                <p className="text-sm text-gray-500 mb-3">
                  This is exactly what will be sent to GrowEasy. Update the
                  mapping above if anything looks wrong.
                </p>

                <div className="overflow-x-auto rounded-xl border shadow">

                  <table className="min-w-full">

                    <thead>

                      <tr>

                        {Object.keys(crmData[0]).map((field) => (

                          <th
                            key={field}
                            className="bg-gradient-to-r from-violet-700 to-purple-700 text-white p-3 text-left whitespace-nowrap"
                          >
                            {field}
                          </th>

                        ))}

                      </tr>

                    </thead>

                    <tbody>

                      {crmData.slice(0, 5).map((row, index) => (

                        <tr
                          key={index}
                          className="hover:bg-gray-50"
                        >

                          {Object.keys(crmData[0]).map((field) => (

                            <td
                              key={field}
                              className="border p-3 whitespace-nowrap text-gray-900"
                            >
                              {row[field] || (
                                <span className="text-gray-400 italic">
                                  empty
                                </span>
                              )}
                            </td>

                          ))}

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

                <p className="text-gray-500 text-sm mt-3">
                  Showing first 5 of {crmData.length} transformed records.
                </p>

                <div className="flex flex-wrap gap-4 mt-4">
                  <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full px-5 py-2 shadow-md shadow-emerald-200">
                    <span className="text-white font-bold">
                      ✅ {crmData.length}
                    </span>{" "}
                    <span className="text-white text-sm">
                      records ready to import
                    </span>
                  </div>

                  {skippedCount > 0 && (
                    <div className="bg-gradient-to-r from-amber-400 to-orange-500 rounded-full px-5 py-2 shadow-md shadow-orange-200">
                      <span className="text-white font-bold">
                        ⚠️ {skippedCount}
                      </span>{" "}
                      <span className="text-white text-sm">
                        skipped (no email or mobile number)
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 items-center justify-between mt-5">

                  <div>
                    {importedCount !== null && (
                      <p className="text-green-700 font-medium">
                        ✅ Imported {importedCount} contacts into GrowEasy
                        CRM
                      </p>
                    )}

                    {importError && (
                      <p className="text-red-600 font-medium">
                        {importError}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">

                    <button
                      onClick={handleDownloadCsv}
                      className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-semibold"
                    >
                      ⬇️ Download CSV
                    </button>

                    <button
                      onClick={handleSendToCrm}
                      disabled={isSendingToCrm}
                      className="bg-gradient-to-r from-fuchsia-600 to-rose-600 hover:from-fuchsia-700 hover:to-rose-700 text-white px-8 py-3 rounded-lg font-semibold shadow-md shadow-fuchsia-200 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-all"
                    >
                      {isSendingToCrm && (
                        <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {isSendingToCrm
                        ? "Importing..."
                        : "🚀 Import to CRM"}
                    </button>

                  </div>

                </div>

              </div>

            )}

          </>
        )}

      </div>

      {/* Toast notification */}
      {showToast && (importedCount !== null || importError) && (
        <div
          className={`fixed top-5 right-5 z-50 max-w-sm px-5 py-4 rounded-xl shadow-xl text-white font-medium transition-opacity animate-fade-in ${
            importError
              ? "bg-gradient-to-r from-rose-600 to-red-600"
              : "bg-gradient-to-r from-emerald-500 to-teal-500"
          }`}
        >
          {importError
            ? `❌ ${importError}`
            : `✅ Imported ${importedCount} contacts into GrowEasy CRM`}
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fadeInUp 0.4s ease-out both;
        }
      `}</style>
    </main>
  );
}