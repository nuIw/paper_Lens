function findAclEvidence(records) {
  const officialUrl = findOfficialProceedingsUrl(records, ["aclanthology.org"]);

  if (officialUrl) {
    return { source: "ACL Anthology", url: officialUrl };
  }

  const doi = records.crossref?.DOI;

  if (typeof doi === "string" && doi.startsWith("10.18653/v1/")) {
    const anthologyId = doi.slice("10.18653/v1/".length);
    return {
      source: "ACL Anthology",
      url: `https://aclanthology.org/${anthologyId}/`,
    };
  }

  return null;
}
