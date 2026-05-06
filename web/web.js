document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.card');
    const fortuneText = document.getElementById('fortune-text');
    const fortuneDesc = document.getElementById('fortune-desc');

    // Sort the "Other projects" pills shortest-to-longest by text length, so
    // the widest pill ends up at the bottom of the stack on desktop.
    const othersList = document.querySelector('.others-list');
    if (othersList) {
        const items = Array.from(othersList.children);
        items.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length);
        items.forEach(item => othersList.appendChild(item));
    }

    // Fade duration must match the CSS transition on .animated-text/.animated-desc
    const FADE_MS = 350;
    let pendingSwap = null;

    // Initial idle state for the prompt
    fortuneText.classList.add('idle');

    // Descriptions keyed by sorted card-keys joined with "+".
    // Single-card states use each card's own data-desc.
    // Any unmapped multi-card state falls back to "An interesting combination..."
    const COMBO_TEXTS = {
        // 2-card combos
        'armada+openevents':
            "These two are useful websites that have served thousands of people IRL! It's been fun to create platforms for real users, creating real value :)",
        'pilot+satellite':
            "I see you're curious about my interest in defense, click on any of these projects to see more",
        'openevents+satellite':
            "These two were made while I've been an intern and had unlimited Claude Code Tokens - can you tell?",
        'openevents+pilot':
            "These two don't have that much in common, but both have been ongoing projects for quite a while!",
        'armada+satellite':
            "KTH students aim for the stars, and Armada can help them get there ;)",
        'armada+pilot':
            "Armada sounds Navy-like, and pilots fly in the Air Force... That's kind of a relationship between these two?",

        // All four
        'armada+openevents+pilot+satellite':
            "These are pretty much all my bigger projects! Hope you like them :)",
    };

    function computeFortune() {
        const flipped = Array.from(cards).filter(c => c.classList.contains('flipped'));

        if (flipped.length === 0) {
            return { title: 'Choose your fortune...', desc: '', isIdle: true };
        }

        if (flipped.length === 1) {
            return { title: flipped[0].dataset.title, desc: flipped[0].dataset.desc, isIdle: false };
        }

        // Multi-card: titles in HTML order joined by " & ", desc looked up by sorted keys
        const titles = flipped.map(c => c.dataset.title).join(' & ');
        const key = flipped.map(c => c.dataset.key).sort().join('+');
        const desc = COMBO_TEXTS[key] || 'An interesting combination...';
        return { title: titles, desc, isIdle: false };
    }

    function swapFortune(title, desc, isIdle) {
        if (pendingSwap) clearTimeout(pendingSwap);

        // Fade out current text
        fortuneText.style.opacity = '0';
        fortuneDesc.style.opacity = '0';

        pendingSwap = setTimeout(() => {
            fortuneText.textContent = title;
            fortuneDesc.textContent = desc;

            if (isIdle) {
                fortuneText.classList.add('idle');
            } else {
                fortuneText.classList.remove('idle');
            }

            fortuneText.style.opacity = '1';
            fortuneDesc.style.opacity = isIdle ? '0' : '1';
            pendingSwap = null;
        }, FADE_MS);
    }

    cards.forEach(card => {
        card.addEventListener('click', function() {
            card.classList.toggle('flipped');
            const { title, desc, isIdle } = computeFortune();
            swapFortune(title, desc, isIdle);
        });
    });
});
