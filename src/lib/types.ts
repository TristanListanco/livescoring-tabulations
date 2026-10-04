export type Decimals = 0 | 1 | 2;

export type Activity = {
  id: string;
  name: string;
  publicId: string;
  min: number;
  max: number;
  decimals: Decimals;
  /** Whether the public live results page shows ranks and sorts by placement. */
  showRank: boolean;
  /** The entry on the LED wall output, or null for an empty green screen. */
  ledEntryId: string | null;
  createdAt: string;
};

export type Judge = {
  id: string;
  name: string;
  photoUrl: string | null;
  position: number;
};

export type Entry = {
  id: string;
  name: string;
  position: number;
};

export type Score = {
  entryId: string;
  judgeId: string;
  value: number;
};

/** Everything a scoreboard needs to render one activity. */
export type Board = {
  activity: Activity;
  judges: Judge[];
  entries: Entry[];
  scores: Score[];
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
