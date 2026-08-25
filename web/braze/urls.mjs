/**
 * Braze dashboard paths, read off the sidebar rather than guessed. Every view is
 * scoped to an app-group id, which is the 24-hex segment in almost every URL.
 */
export const paths = {
  home: g => `/dashboard/app_usage/${g}?locale=en`,
  campaigns: g => `/engagement/campaigns/campaigns/${g}?locale=en`,
  /**
   * The campaign index with its view state spelled out, taken from a real URL
   * off the dashboard:
   *
   *   /engagement/campaigns/campaigns/<group>?start=0&limit=96&globalFilter=
   *     &sortby=last_edited&sortdir=-1&display=list
   *
   * This matters more than it looks. The index keeps its paging, sorting and
   * filtering in the query string, so the ledger sync can ask for a window of
   * rows outright instead of hunting for a "Next" button and clicking it — one
   * navigation per page, nothing to mis-resolve, and a truncated read is
   * arithmetic rather than a guess.
   *
   * `extra` carries whatever else the view needs; the status filter's parameter
   * is not known yet, and the flow reads it back off the URL after clearing the
   * filter by hand so it can be pinned here later.
   */
  campaignList: (g, { start = 0, limit = 100, sortby = "last_edited", sortdir = -1, display = "list", globalFilter = "", extra = {} } = {}) => {
    const query = new URLSearchParams({
      locale: "en",
      start: String(start),
      limit: String(limit),
      globalFilter,
      sortby,
      sortdir: String(sortdir),
      display,
      ...extra,
    });
    return `/engagement/campaigns/campaigns/${g}?${query}`;
  },
  /** The campaign wizard. page: 0 Compose, 1 Schedule, 2 Target, 3 Assign, 4 Review. */
  campaign: (id, g, page = 0) => `/engagement/campaigns/${id}/${g}?locale=en&page=${page}`,
  segments: g => `/engagement/segmenter/segmenter/${g}?locale=en`,
  userImport: g => `/users/user_import/${g}?locale=en`,
  mediaLibrary: g => `/engagement/templates_and_media/media_library/${g}?locale=en`,
  emailTemplates: g => `/engagement/templates_and_media/email_templates/${g}?locale=en`,
  sendCalendar: g => `/engagement/campaigns/future_send_calendar/${g}?locale=en`,
};

export const WIZARD = { compose: 0, schedule: 1, target: 2, assign: 3, review: 4 };

const APP_GROUP_RE = /[0-9a-f]{24}/;

/** The app group is stamped into every dashboard URL, so it can be read back. */
export function appGroupFromUrl(url) {
  return url.match(APP_GROUP_RE)?.[0] ?? null;
}

export function campaignIdFromUrl(url) {
  return url.match(/\/engagement\/campaigns\/([0-9a-f]{24})\//)?.[1] ?? null;
}
