async function searchDblp(title) {
  const url = new URL("https://dblp.org/search/publ/api");
  const exactQuery = title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean)
    .map((word) => `${word}$`)
    .join(" ");

  url.searchParams.set("q", exactQuery || title);
  url.searchParams.set("format", "json");
  url.searchParams.set("h", "50");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`DBLP request failed: ${response.status}`);
  }

  return response.json();
}

function getDblpHits(data) {
  return data.result?.hits?.hit ?? [];
}
