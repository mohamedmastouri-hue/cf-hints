(function () {
  function getText(element) {
    return element ? element.innerText.replace(/\s+\n/g, "\n").trim() : "";
  }

  function scrapeProblem() {
    const titleElement = document.querySelector(".problem-statement .title");
    const statementElement = document.querySelector(".problem-statement");

    const title = getText(titleElement) || document.title.replace(" - Codeforces", "").trim();
    const statement = getText(statementElement);
    const url = window.location.href.split("#")[0];

    if (!statement) {
      return;
    }

    chrome.storage.local.set({
      title,
      statement,
      url,
      currentProblem: {
        title,
        statement,
        url
      }
    });
  }

  scrapeProblem();
})();
