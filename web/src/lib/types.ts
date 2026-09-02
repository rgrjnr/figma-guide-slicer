/** Shared between the browser and the API. No server-only imports here. */

/** A link back to something that exists in Braze, so it can be re-read later. */
export interface BrazeRef {
  id: string;
  name: string;
  /** Deep link into the dashboard. */
  url: string;
  /** When this record was last confirmed against the live dashboard. */
  checkedAt?: string;
}

export interface ScheduleRecord {
  /** What the user asked for: wall clock plus IANA zone. */
  requestedAt: string;
  requestedZone: string;
  /** What Braze was actually told, in the workspace's own zone. */
  workspaceLocal: string;
  workspaceZone: string;
  utc: string;
  localTimeDelivery: boolean;
}

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepRecord {
  status: StepStatus;
  at?: string;
  /** Run directory under web/.runs, for the screenshots of that attempt. */
  runId?: string;
  error?: string;
}

/**
 * One end-to-end job: the design, its markup, the audience, and whatever it
 * became in Braze. Everything is editable and every Braze object is recorded by
 * id and URL so the live state can be re-read rather than assumed.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  /** The slicer state, so markup can be reopened and changed. */
  markup: {
    imageName?: string;
    /**
     * The artwork itself, as `source.<ext>` under the project's asset dir. The
     * marks are meaningless without the image they were drawn on, and the image
     * is the one thing in a project that cannot be typed again — so it is kept
     * next to them rather than left on whoever's laptop uploaded it. Absent on
     * every project saved before this existed, which reads as "ask for the file".
     */
    imageFile?: string;
    imageWidth?: number;
    imageHeight?: number;
    designWidth: number;
    emailWidth: number;
    guides: number[];
    workArea: { y0: number; y1: number } | null;
    rows: Record<string, unknown>;
    addFooter: boolean;
    minGutter: number;
    minSection: number;
  };

  email: {
    subject?: string;
    preheader?: string;
    /** Relative path under the project's asset directory. */
    zipFile?: string;
  };

  audience: {
    csv?: string;
    /** The file name decides the segment name in Braze. */
    fileName?: string;
    count?: number;
  };

  braze: {
    appGroup?: string;
    campaign?: BrazeRef;
    segment?: BrazeRef;
    /** The user-import row, which is what creates the segment. */
    import?: BrazeRef & { records?: string; status?: string };
    schedule?: ScheduleRecord;
    /** Read off the Review step. The number of people who would receive it. */
    reachableUsers?: number;
    controlGroupRemoved?: boolean;
    /**
     * When the campaign was committed. Set only by the launch flow, and only
     * after it actually clicked Launch Campaign — a preflight that merely read
     * the review page never writes it.
     */
    launchedAt?: string;
  };

  steps: {
    slice: StepRecord;
    import: StepRecord;
    draft: StepRecord;
    schedule: StepRecord;
  };
}

export function emptySteps(): ProjectRecord["steps"] {
  const pending = (): StepRecord => ({ status: "pending" });
  return { slice: pending(), import: pending(), draft: pending(), schedule: pending() };
}
