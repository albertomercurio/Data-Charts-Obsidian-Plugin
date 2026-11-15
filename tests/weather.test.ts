import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { addDays, addYears, allowedRange, archiveUrl, available, daysBetween, forecastUrl, geocodeUrl, parseForecast, parseWeatherSpec, pastYears, pending, placeFrom, placeName, sky, typicalDays } from "../src/weather";

const TODAY = "2026-11-15";
const spec = (yaml: string, self: Record<string, unknown> = {}) => parseWeatherSpec(yaml, parse, self, TODAY);
const trip = { Date: "2026-12-04T09:30", "End Date": "2026-12-07", Places: ["[[Notes/Edinburgh|Edimburgo]]"] };

test("weather: the block, with the note's properties", () => {
  const s = spec("place: this.Places\nfrom: this.Date\nto: this.End Date", trip);
  assert.deepEqual(s, { place: "Edinburgh", from: "2026-12-04", to: "2026-12-07", units: "metric" });
  assert.equal(spec("place: this.Places\nfrom: this.`End Date`", trip).from, "2026-12-07");
  assert.deepEqual(spec("place: Paris\ncountry: us"), { place: "Paris", country: "US", from: TODAY, to: "2026-11-21", units: "metric" });
  assert.deepEqual(spec("latitude: 55.95\nlongitude: -3.19\nplace: Home\nunits: imperial"), { place: "Home", latitude: 55.95, longitude: -3.19, from: TODAY, to: "2026-11-21", units: "imperial" });
  assert.deepEqual([spec("place: Lausanne\ndays: 3").from, spec("place: Lausanne\ndays: 3").to], [TODAY, "2026-11-17"]);
  assert.equal(spec("place: Lausanne\nfrom: 2026-12-04\ndays: 1").to, "2026-12-04");
  assert.equal(placeName("[[Edinburgh#Old Town]]"), "Edinburgh");
  assert.equal(placeName([]), undefined);
});

test("weather: errors that say what to write", () => {
  assert.throws(() => spec("city: Rome"), { message: /^city: unknown key/ });
  assert.throws(() => spec("from: 2026-12-04"), { message: /^place:/ });
  assert.throws(() => spec("place: this.Places"), { message: /^place: this.Places is empty/ });
  assert.throws(() => spec("place: Rome\nfrom: 2026-12-04\nto: 2026-12-01"), { message: /^to: 2026-12-01 comes before/ });
  assert.throws(() => spec("place: Rome\nfrom: December"), { message: /^from: a day/ });
  assert.throws(() => spec("latitude: 41.9"), { message: /^latitude and longitude/ });
  assert.throws(() => spec("place: Rome\nunits: kelvin"), { message: /^units:/ });
  assert.throws(() => spec("place: Rome\ndays: 0"), { message: /^days: a whole number/ });
  assert.throws(() => spec("place: Rome\ndays: 2\nto: 2026-12-01"), { message: /^days or to/ });
});

test("weather: the days the forecast reaches, and when it reaches the others", () => {
  const s = spec("place: Edinburgh\nfrom: 2026-12-04\nto: 2026-12-07");
  assert.equal(available(s, TODAY), null);
  assert.deepEqual(pending(s, TODAY), { from: "2026-12-04", to: "2026-12-07", on: "2026-11-19" });
  assert.deepEqual(available(s, "2026-11-20"), { from: "2026-12-04", to: "2026-12-05" });
  assert.deepEqual(pending(s, "2026-11-20"), { from: "2026-12-06", to: "2026-12-07", on: "2026-11-21" });
  assert.equal(pending(s, "2026-11-22"), null);
  assert.deepEqual(available(s, "2026-12-10"), { from: "2026-12-04", to: "2026-12-07" });
  assert.equal(available(s, "2027-04-01"), null);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("weather: the addresses and the answers of Open-Meteo", () => {
  assert.equal(geocodeUrl("Paris", "US"), "https://geocoding-api.open-meteo.com/v1/search?name=Paris&count=1&language=en&format=json&countryCode=US");
  const place = placeFrom({ results: [{ name: "Edinburgh", admin1: "Scotland", country: "United Kingdom", latitude: 55.95206, longitude: -3.19648 }] }, "Edinburgh");
  assert.deepEqual(place, { label: "Edinburgh, Scotland, United Kingdom", latitude: 55.95206, longitude: -3.19648 });
  assert.throws(() => placeFrom({ generationtime_ms: 0.1 }, "Nowhere", "IT"), { message: 'no place named "Nowhere" in IT' });

  const url = new URL(forecastUrl(place, { from: "2026-12-04", to: "2026-12-07" }, "imperial"));
  assert.deepEqual([url.searchParams.get("latitude"), url.searchParams.get("start_date"), url.searchParams.get("end_date"), url.searchParams.get("temperature_unit")], ["55.9521", "2026-12-04", "2026-12-07", "fahrenheit"]);
  assert.equal(new URL(forecastUrl(place, { from: "2026-12-04", to: "2026-12-04" }, "metric")).searchParams.get("temperature_unit"), null);

  const refused = { error: true, reason: "Parameter 'start_date' is out of allowed range from 2026-08-14 to 2026-11-30" };
  assert.deepEqual(allowedRange(refused), { from: "2026-08-14", to: "2026-11-30" });
  assert.equal(allowedRange({ daily: {} }), null);
  assert.throws(() => parseForecast(refused), { message: /out of allowed range/ });

  const forecast = parseForecast({
    daily_units: { temperature_2m_max: "°C", precipitation_sum: "mm", wind_speed_10m_max: "km/h" },
    daily: {
      time: ["2026-11-29", "2026-11-30"],
      weather_code: [53, null],
      temperature_2m_max: [6.2, null],
      temperature_2m_min: [1.1, null],
      precipitation_probability_max: [null, null],
      precipitation_sum: [4.0, null],
      wind_speed_10m_max: [26.1, null],
      sunrise: ["2026-11-29T08:15", "2026-11-30T08:17"],
      sunset: ["2026-11-29T15:45", "2026-11-30T15:44"],
    },
  });
  assert.deepEqual(forecast.units, { temperature: "°C", rain: "mm", wind: "km/h" });
  assert.deepEqual(forecast.days[0], { date: "2026-11-29", code: 53, max: 6.2, min: 1.1, chance: null, rain: 4, wind: 26.1, sunrise: "2026-11-29T08:15", sunset: "2026-11-29T15:45" });
  assert.equal(forecast.days[1].max, null);
  assert.equal(parseForecast({ daily_units: { wind_speed_10m_max: "mp/h" }, daily: { time: [] } }).units.wind, "mph");
});

test("weather: the typical weather of days beyond the forecast", () => {
  assert.equal(addYears("2028-02-29", -1), "2027-02-28");
  assert.equal(addYears("2026-12-04", -10), "2016-12-04");
  assert.deepEqual(daysBetween("2026-12-30", "2027-01-01"), ["2026-12-30", "2026-12-31", "2027-01-01"]);

  const years = pastYears({ from: "2026-12-04", to: "2026-12-07" }, TODAY);
  assert.equal(years.length, 10);
  assert.deepEqual([years[0], years[9]], [{ from: "2025-12-04", to: "2025-12-07" }, { from: "2016-12-04", to: "2016-12-07" }]);
  // Days a year ago that the archive does not have yet are left out.
  assert.deepEqual(pastYears({ from: "2027-11-13", to: "2027-11-14" }, TODAY)[0], { from: "2025-11-13", to: "2025-11-14" });

  const url = new URL(archiveUrl({ latitude: 55.95, longitude: -3.19 }, years[0], "metric"));
  assert.equal(url.host, "archive-api.open-meteo.com");
  assert.equal(url.searchParams.get("daily")?.includes("precipitation_probability_max"), false);
  assert.equal(new URL(forecastUrl({ latitude: 55.95, longitude: -3.19 }, years[0], "metric")).searchParams.get("daily")?.includes("precipitation_probability_max"), true);

  const year = (y: number, max: number, rain: number) => parseForecast({
    daily: { time: [`${y}-12-04`, `${y}-12-05`], temperature_2m_max: [max, max + 1], temperature_2m_min: [max - 5, null], precipitation_sum: [rain, 0], wind_speed_10m_max: [20, 30], sunrise: [`${y}-12-04T08:2${y % 10}`, null], sunset: [`${y}-12-04T15:4${y % 10}`, null] },
  });
  const typical = typicalDays(["2026-12-04", "2026-12-05"], [year(2025, 8, 4), year(2024, 6, 0.5)], 1);
  assert.deepEqual(typical[0], { date: "2026-12-04", code: null, max: 7, min: 2, chance: 50, rain: 2.25, wind: 20, sunrise: "2025-12-04T08:25", sunset: "2025-12-04T15:45", typical: true });
  assert.deepEqual([typical[1].max, typical[1].min, typical[1].chance], [8, null, 0]);
  assert.equal(typicalDays(["2028-02-29"], [parseForecast({ daily: { time: ["2027-02-28"], temperature_2m_max: [3] } })], 1)[0].max, 3);
});

test("weather: a symbol for every WMO code", () => {
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) assert.notEqual(sky(code).icon, "", String(code));
  assert.deepEqual(sky(null), { icon: "", text: "" });
});

test("weather: the examples of the README are valid blocks", () => {
  const blocks = [...readFileSync("README.md", "utf8").matchAll(/```data-weather\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, String(blocks.length));
  for (const block of blocks) assert.doesNotThrow(() => spec(block, trip), block);
});
