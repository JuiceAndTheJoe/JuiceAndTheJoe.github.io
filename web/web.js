document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.card');
    const fortuneText = document.getElementById('fortune-text');
    const fortuneDesc = document.getElementById('fortune-desc');

    cards.forEach(card => {
        card.addEventListener('click', function() {
            card.classList.toggle('flipped');

            if (card.classList.contains('flipped')) {
                // Update text content
                fortuneText.textContent = card.dataset.title;
                fortuneDesc.textContent = card.dataset.desc;

                // Show fortune text with animation
                fortuneText.style.opacity = "1";
                fortuneText.style.animation = "fadeIn 4s infinite"; // Keeps fading in/out

                // Show fortune description gradually and keep it visible
                fortuneDesc.style.opacity = "1";
                fortuneDesc.style.animation = "fadeInOnce 1s ease-in-out forwards";
            } else {
                // Reset only if no cards are flipped
                const anyFlipped = Array.from(cards).some(c => c.classList.contains('flipped'));
                if (!anyFlipped) {
                    fortuneText.textContent = "Choose your fortune...";
                    fortuneDesc.textContent = "";

                    // Hide text again
                    fortuneDesc.style.opacity = "0";
                    fortuneDesc.style.animation = "none";
                }
            }
        });
    });
});
