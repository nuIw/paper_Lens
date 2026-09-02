async function searchOpenReview(title) {
  const url = new URL("https://api2.openreview.net/notes/search");
  url.searchParams.set("term", title);
  url.searchParams.set("type", "terms");
  url.searchParams.set("content", "title");
  url.searchParams.set("source", "forum");
  url.searchParams.set("limit", "10");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OpenReview request failed: ${response.status}`);
  }

  return response.json();
}

function getOpenReviewNotes(data) {
  return data.notes ?? [];
}

function getOpenReviewValue(field) {
  return field?.value ?? field ?? null;
}

function getOpenReviewAuthors(note) {
  const authors = getOpenReviewValue(note.content?.authors) ?? [];
  const authorList = Array.isArray(authors) ? authors : [authors];

  return authorList
    .map((author) => getOpenReviewValue(author))
    .filter((author) => typeof author === "string");
}
