function normalizeText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{M}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthorName(name) {
  const nameParts = name.split(",").map((part) => part.trim());
  const reorderedName =
    nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : name;

  return normalizeText(reorderedName);
}
