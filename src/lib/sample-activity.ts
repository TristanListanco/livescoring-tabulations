import { blankScoring, type CriterionDraft, type PageantDraft, type PartDraft, type RoundDraft, type ScoringDraft } from "./pageant-setup";
import type { Segment } from "./types";

/**
 * A sample activity's create form, filled in with made-up people, for trying the app out on a test site (see
 * createSample): an event scored live by criteria, or a pageant with a full program. Sent through the create form's own
 * path, so it's set up exactly as one an organizer typed.
 */

export type SampleKind = "event" | "pageant";

const JUDGES = [
  ["Ana", "Cruz"],
  ["Ben", "Torres"],
  ["Carla", "Reyes"],
  ["Dan", "Lim"],
  ["Eva", "Santos"],
];
const TEAMS = ["Team Alpha", "Team Bravo", "Team Charlie", "Team Delta", "Team Echo", "Team Foxtrot"];
/** Candidates, each with their hometown (the entries' one field of details). */
const CANDIDATES = [
  ["Ayla Mendoza", "Cebu City"],
  ["Bea Santos", "Davao City"],
  ["Cora Reyes", "Iligan City"],
  ["Dina Ramos", "Baguio City"],
  ["Ella Navarro", "Iloilo City"],
  ["Faye Villanueva", "Zamboanga City"],
  ["Gia Domingo", "Bacolod City"],
  ["Hana Castillo", "Cagayan de Oro"],
];

const criteria = (list: [string, number][]): CriterionDraft[] => list.map(([name, max], key) => ({ key, id: "", name, max: String(max), min: "", guide: "" }));
const byCriteria = (list: [string, number][]): ScoringDraft => ({ ...blankScoring(), mode: "criteria", decimals: 0, criteria: criteria(list), display: "percent" });
const part = (key: string, name: string, weight: string, list: [string, number][]): PartDraft => ({ key, name, weight, scoring: byCriteria(list), timer: "" });
const round = (key: string, segment: Segment, name: string, weight: string, scoring: ScoringDraft, extra: Partial<RoundDraft> = {}): RoundDraft => ({
  key,
  segment,
  name,
  weight,
  scoring,
  timer: "",
  cut: false,
  cutSize: "",
  cutBasis: null,
  parts: null,
  ...extra,
});

/**
 * The sample pageant's program: the preliminary (40%) with a closed-door interview that's deliberated and a production
 * number in two parts; pageant proper with swimsuit and evening gown, a Top 5 cut, then the Q&A and the final cut.
 */
export const SAMPLE_PROGRAM: PageantDraft = {
  preliminaryWeight: "40",
  rounds: [
    round("interview", "preliminary", "Closed-door interview", "20", byCriteria([["Intelligence", 50], ["Personality", 30], ["Poise", 20]]), { deliberate: true }),
    round("production", "preliminary", "Production number", "20", blankScoring(), {
      parts: [
        part("production-number", "Number", "10", [["Choreography", 50], ["Stage presence", 50]]),
        part("production-intro", "Introduction", "10", [["Delivery", 60], ["Confidence", 40]]),
      ],
    }),
    round("swimsuit", "proper", "Swimsuit", "30", byCriteria([["Figure", 50], ["Confidence", 30], ["Stage presence", 20]])),
    round("gown", "proper", "Evening gown", "30", byCriteria([["Elegance", 40], ["Poise", 30], ["Overall impact", 30]]), { cut: true, cutSize: "5" }),
    round("qa", "proper", "Question and answer", "100", byCriteria([["Substance", 50], ["Delivery", 30], ["Confidence", 20]]), { cut: true, cutSize: "3" }),
  ],
  violations: null,
};

const stamp = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function sampleForm(kind: SampleKind, now = new Date()): FormData {
  const pageant = kind === "pageant";
  const form = new FormData();
  const judges = pageant ? JUDGES : JUDGES.slice(0, 3);
  form.set("consent", "on");
  form.set("name", `Sample ${pageant ? "pageant" : "event"} · ${stamp.format(now)}`);
  form.set("location", pageant ? "Grand Ballroom" : "Main Hall");
  form.set("result_decimals", "2");
  form.set("signatories", JSON.stringify([{ name: "Sam Rivera", designation: "Tabulator" }]));
  form.set("judgeCount", String(judges.length));
  judges.forEach(([first, last], i) => {
    form.set(`judge-${i}-first_name`, first);
    form.set(`judge-${i}-last_name`, last);
  });
  if (pageant) {
    form.set("kind", "pageant");
    form.set("entry_field", "Hometown");
    form.set("entries", CANDIDATES.map(([name, town]) => `${name}|${town}`).join("\n"));
    // One board of judges, Ana its chair.
    form.set("chair", "0");
    form.set("pageant", JSON.stringify(SAMPLE_PROGRAM));
  } else {
    form.set("entries", TEAMS.join("\n"));
    // Scored live, so there's no chair: the organizer moves between entries.
    form.set("live_scoring", "on");
    form.set("scoring_mode", "criteria");
    form.set("decimals", "0");
    form.set("criteria_display", "percent");
    form.set("criteria", JSON.stringify(criteria([["Content", 40], ["Delivery", 30], ["Impact", 30]])));
  }
  return form;
}
