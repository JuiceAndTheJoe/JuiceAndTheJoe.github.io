// Types out the `claude --list-projects` command, then "prints" the project
// rows in sequence by flipping body.booted (CSS handles the staggered reveal).
// Falls back to showing everything instantly when reduced motion is requested.
(function () {
    const body = document.body;
    const cmd = document.getElementById('cmd');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function boot() {
        body.classList.add('booted');
    }

    // No command element, or the user prefers reduced motion: skip the typing
    // animation and reveal the catalog immediately.
    if (!cmd || reduce) {
        if (cmd && cmd.dataset.cmd) cmd.textContent = cmd.dataset.cmd;
        boot();
        return;
    }

    const text = cmd.dataset.cmd || cmd.textContent;
    cmd.textContent = '';
    cmd.classList.add('typing');

    let i = 0;
    (function type() {
        if (i <= text.length) {
            cmd.textContent = text.slice(0, i);
            i++;
            // Slightly irregular cadence so it reads like a human typing.
            setTimeout(type, 38 + Math.random() * 45);
        } else {
            cmd.classList.remove('typing');
            setTimeout(boot, 180);
        }
    })();
})();

// Accordion: only one project expanded at a time, so the catalog always fits
// the single, unscrollable screen.
(function () {
    const projects = Array.from(document.querySelectorAll('.project'));
    projects.forEach(function (details) {
        details.addEventListener('toggle', function () {
            if (!details.open) return;
            projects.forEach(function (other) {
                if (other !== details) other.open = false;
            });
        });
    });
})();

