async function searchOpenAlex(title, apiKey) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", `"${title}"`);
  url.searchParams.set("per-page", "25");
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OpenAlex request failed: ${response.status}`);
  }

  return response.json();
}

function getOpenAlexWorks(data) {
  return data.results ?? [];
}
