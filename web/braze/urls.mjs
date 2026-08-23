/**
 * Braze dashboard paths, read off the sidebar rather than guessed. Every view is
 * scoped to an app-group id, which is the 24-hex segment in almost every URL.
 */
export const paths = {
  home: g => `/dashboard/app_usage/${g}?locale=en`,
  campaigns: g => `/engagement/campaigns/campaigns/${g}?locale=en`,
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
