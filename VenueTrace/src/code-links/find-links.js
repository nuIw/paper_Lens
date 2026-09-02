function findProjectLinks(root = document) {
  const projectHosts = [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "huggingface.co",
  ];
  const links = [
    ...root.querySelectorAll(
      ".metatable a[href], blockquote.abstract a[href]",
    ),
  ];
  const seenUrls = new Set();

  return links.flatMap((link) => {
    try {
      const url = new URL(link.href);
      const isProjectHost = projectHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      );

      if (!isProjectHost || seenUrls.has(url.href)) {
        return [];
      }

      seenUrls.add(url.href);
      return [
        {
          url: url.href,
          host: url.hostname,
          foundAt: link.closest?.(".comments")
            ? "arXiv Comments"
            : "arXiv Abstract",
        },
      ];
    } catch {
      return [];
    }
  });
}
