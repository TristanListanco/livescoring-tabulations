-- Photo buckets take only photos, of a sensible size.
--
-- judge-photos and organizer-photos: the server already checks every photo before it uploads it (an image under 2 MB:
-- JPEG, PNG or WebP, told by its first bytes, not its name), and only the server can upload. The buckets now hold to the
-- same, so a file that got past the server some other way is refused by storage itself.
--
-- Run in the Supabase SQL editor after 036, or let the release pipeline run it. Safe to run again. Where storage has no
-- such settings (an old project, or a database without Supabase Storage), it does nothing.

do $migration$
begin
  if to_regclass('storage.buckets') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    return;
  end if;

  update storage.buckets
     set file_size_limit = 2 * 1024 * 1024,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id in ('judge-photos', 'organizer-photos');
end;
$migration$;
