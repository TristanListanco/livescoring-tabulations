import type { MetadataRoute } from "next";

/**
 * Search engines may read the start page and the policies, nothing else: the admin panel and the judges' screens are
 * behind sign-in, and an event's live results and LED wall are for the people its organizer gives the link to.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/judge", "/live", "/led"] } };
}
