async function searchCrossref(title) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.title", title);
  url.searchParams.set("rows", "10");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Crossref request failed: ${response.status}`);
  }

  return response.json();
}

function getCrossrefWorks(data) {
  return data.message?.items ?? [];
}
