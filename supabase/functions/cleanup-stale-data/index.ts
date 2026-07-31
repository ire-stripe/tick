import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { checkCronAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Keep today + yesterday.
const EPISODE_RETENTION_DAYS = 2;

// Article text is cheap. Keep this longer so the app still has useful recent history.
const ARTICLE_RETENTION_DAYS = 30;

// Per-article audio is expensive. If you are not using per-article audio, keep this low.
const ARTICLE_AUDIO_RETENTION_DAYS = 2;

const BATCH_SIZE = 100;

function isoDateDaysAgo(daysAgo: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function isoTimestampDaysAgo(daysAgo: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function isDateFolder(name: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

async function listFilesRecursive(bucket: string, prefix = ""): Promise<string[]> {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
  });

  if (error) throw error;

  const files: string[] = [];

  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;

    // Supabase Storage folders usually do not have an id. Files do.
    if (item.id) {
      files.push(path);
    } else {
      files.push(...(await listFilesRecursive(bucket, path)));
    }
  }

  return files;
}

async function removeStorageFiles(bucket: string, paths: string[]) {
  let deleted = 0;

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    if (!batch.length) continue;

    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) throw error;

    deleted += batch.length;
  }

  return deleted;
}

async function cleanupBriefStorage() {
  // If today is 2026-07-31, this is 2026-07-30.
  // We keep folders >= yesterday and delete folders < yesterday.
  const oldestKeptDate = isoDateDaysAgo(EPISODE_RETENTION_DAYS - 1);

  const { data, error } = await supabase.storage.from("briefs").list("", {
    limit: 1000,
  });

  if (error) throw error;

  const foldersToDelete = (data ?? [])
    .map((item) => item.name)
    .filter((name) => isDateFolder(name))
    .filter((name) => name < oldestKeptDate);

  let filesDeleted = 0;

  for (const folder of foldersToDelete) {
    const files = await listFilesRecursive("briefs", folder);
    filesDeleted += await removeStorageFiles("briefs", files);
  }

  return {
    oldestKeptDate,
    foldersDeleted: foldersToDelete,
    filesDeleted,
  };
}

async function cleanupEpisodes() {
  // Keep today + yesterday.
  // Delete anything older than yesterday.
  const oldestKeptDate = isoDateDaysAgo(EPISODE_RETENTION_DAYS - 1);

  const { count, error } = await supabase
    .from("episodes")
    .delete({ count: "exact" })
    .lt("date", oldestKeptDate);

  if (error) throw error;

  return {
    oldestKeptDate,
    rowsDeleted: count ?? 0,
  };
}

async function cleanupOldArticleAudio() {
  const cutoff = isoTimestampDaysAgo(ARTICLE_AUDIO_RETENTION_DAYS);

  const { data, error } = await supabase
    .from("articles")
    .select("id")
    .not("article_audio_url", "is", null)
    .lt("published_at", cutoff)
    .limit(5000);

  if (error) throw error;

  const ids = (data ?? []).map((row) => row.id as string).filter(Boolean);
  const paths = ids.map((id) => `${id}.wav`);

  const filesDeleted = await removeStorageFiles("articles", paths);

  if (ids.length) {
    const { error: updateErr } = await supabase
      .from("articles")
      .update({
        article_audio_url: null,
      })
      .in("id", ids);

    if (updateErr) throw updateErr;
  }

  return {
    cutoff,
    articleRowsUpdated: ids.length,
    filesDeleted,
  };
}

async function cleanupArticles() {
  const cutoff = isoTimestampDaysAgo(ARTICLE_RETENTION_DAYS);

  const { count, error } = await supabase
    .from("articles")
    .delete({ count: "exact" })
    .lt("published_at", cutoff);

  if (error) throw error;

  return {
    cutoff,
    rowsDeleted: count ?? 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    checkCronAuth(req);

    const briefStorage = await cleanupBriefStorage();
    const episodes = await cleanupEpisodes();
    const articleAudio = await cleanupOldArticleAudio();
    const articles = await cleanupArticles();

    return new Response(
      JSON.stringify({
        ok: true,
        retention: {
          episodes: `${EPISODE_RETENTION_DAYS} days`,
          articleAudio: `${ARTICLE_AUDIO_RETENTION_DAYS} days`,
          articles: `${ARTICLE_RETENTION_DAYS} days`,
        },
        briefStorage,
        episodes,
        articleAudio,
        articles,
      }),
      {
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error(err);

    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
      },
    );
  }
});