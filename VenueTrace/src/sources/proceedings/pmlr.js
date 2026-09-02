function getMatchedRecordUrls(records) {
  const dblpUrls = records.dblp?.info?.ee ?? [];

  return [
    ...(Array.isArray(dblpUrls) ? dblpUrls : [dblpUrls]),
    records.crossref?.URL,
    records.crossref?.resource?.primary?.URL,
    records.openAlex?.primary_location?.landing_page_url,
    ...(records.openAlex?.locations ?? []).map(
      (location) => location.landing_page_url,
    ),
  ].filter((url) => typeof url === "string");
}

function findOfficialProceedingsUrl(records, hostnames) {
  return (
    getMatchedRecordUrls(records).find((url) => {
      try {
        return hostnames.includes(new URL(url).hostname);
      } catch {
        return false;
      }
    }) ?? null
  );
}

function findPmlrEvidence(records) {
  const url = findOfficialProceedingsUrl(records, ["proceedings.mlr.press"]);
  return url ? { source: "PMLR", url } : null;
}
