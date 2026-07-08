import { redirect } from "next/navigation";

// The dedicated LinkedIn-from-resource journey has been folded into the main
// wizard at /content-calendar/create (select LinkedIn as the platform).
// This route is kept only so old links/bookmarks don't 404.
export default function CreateLinkedInCalendarPage() {
  redirect("/content-calendar/create");
}
