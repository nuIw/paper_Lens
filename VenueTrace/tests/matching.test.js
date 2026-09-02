const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadContext(files, globals = {}) {
  const context = vm.createContext({ console, URL, ...globals });

  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
      filename: file,
    });
  }

  return context;
}

test("DBLP matching prefers a conference version over a later journal version", () => {
  const context = loadContext([
    "src/matching/normalize.js",
    "src/matching/paper-matcher.js",
  ]);
  const paper = {
    title: "A Style-Based Generator Architecture for Generative Adversarial Networks",
    authors: ["Tero Karras"],
    submittedYear: 2018,
  };
  const common = {
    title: paper.title,
    authors: { author: [{ text: "Tero Karras" }] },
  };
  const match = context.findMatchingPaper(paper, [
    {
      info: {
        ...common,
        venue: "IEEE Trans. Pattern Anal. Mach. Intell.",
        year: "2021",
        key: "journals/pami/KarrasLA21",
      },
    },
    {
      info: {
        ...common,
        venue: "CVPR",
        year: "2019",
        key: "conf/cvpr/KarrasLA19",
      },
    },
  ]);

  assert.equal(match.info.venue, "CVPR");
  assert.equal(match.info.year, "2019");
});

test("CVF lookup verifies the generated official proceedings page", async () => {
  const requestedUrls = [];
  const fetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      async text() {
        return `<html><body>A Style-Based Generator Architecture for Generative Adversarial Networks Tero Karras</body></html>`;
      },
    };
  };
  const context = loadContext([
    "src/matching/normalize.js",
    "src/sources/proceedings/pmlr.js",
    "src/sources/proceedings/neurips.js",
    "src/sources/proceedings/cvf.js",
  ], { fetch });
  const paper = {
    title: "A Style-Based Generator Architecture for Generative Adversarial Networks",
    authors: ["Tero Karras"],
  };
  const evidence = await context.searchOfficialCvfPaper(paper, {
    crossref: {
      author: [{ family: "Karras" }],
      "container-title": [
        "2019 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)",
      ],
      published: { "date-parts": [[2019]] },
    },
  });

  assert.equal(evidence.venue, "CVPR");
  assert.equal(evidence.year, 2019);
  assert.match(requestedUrls[0], /content_CVPR_2019/);
  assert.match(requestedUrls[0], /Karras_A_Style-Based_Generator/);
});
