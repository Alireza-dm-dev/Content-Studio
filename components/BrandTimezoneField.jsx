"use client";

import { isValidIanaTimezone } from "@/lib/timezone";

function listTimezones() {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC", "Europe/London", "America/Vancouver", "America/New_York"];
  }
}

const ZONES = listTimezones();

// Searchable IANA timezone picker (type to filter; native datalist).
export default function BrandTimezoneField({ value, onChange, inputStyle, helpStyle }) {
  const invalid = !!value && !isValidIanaTimezone(value);
  return (
    <>
      <input
        name="timezone"
        list="brand-timezone-options"
        value={value}
        onChange={onChange}
        placeholder="e.g. Europe/London"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby="brandTimezoneHelp"
        style={inputStyle}
      />
      <datalist id="brand-timezone-options">
        {ZONES.map((z) => <option key={z} value={z} />)}
      </datalist>
      <div id="brandTimezoneHelp" style={helpStyle}>
        {invalid
          ? "Not a valid IANA timezone. Pick one from the list (e.g. Europe/London)."
          : "Used for publishing and scheduling times for this brand. Daylight saving is handled automatically."}
        {!value && " No timezone set — scheduling falls back to America/Vancouver."}
      </div>
    </>
  );
}
