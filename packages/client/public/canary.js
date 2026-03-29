(function () {
  var el = document.getElementById('canary-text');
  var status = document.getElementById('canary-status');

  fetch('/canary.txt')
    .then(function (r) { return r.text(); })
    .then(function (text) {
      el.textContent = text;

      var match = text.match(/As of (\d{4}-\d{2}-\d{2})/);
      if (match) {
        var canaryDate = new Date(match[1] + 'T00:00:00Z');
        var now = new Date();
        var daysSince = Math.floor((now.getTime() - canaryDate.getTime()) / 86400000);

        if (daysSince <= 60) {
          status.className = 'ok';
          status.textContent = 'canary is current — last signed ' + match[1] + ' (' + daysSince + ' days ago)';
        } else {
          status.className = 'stale';
          status.textContent = 'WARNING: canary is ' + daysSince + ' days old — last signed ' + match[1];
        }
      } else {
        status.className = 'unknown';
        status.textContent = 'could not parse canary date';
      }
    })
    .catch(function () {
      el.textContent = 'failed to load canary.txt';
      status.className = 'stale';
      status.textContent = 'WARNING: canary could not be loaded';
    });
})();
