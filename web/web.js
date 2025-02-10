document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.addEventListener('click', function() {
            card.classList.toggle('flipped');
            const cardText = this.querySelector('.card-front').textContent;
            let fortuneText = '';
            switch (cardText) {
            case 'AOS':
                fortuneText = 'AOS';
                break;
            case 'On the Move with Daniel':
                fortuneText = 'On the Move with Daniel';
                break;
            case 'Drawing App':
                fortuneText = 'Drawing App';
                break;
            default:
                fortuneText = 'Choose your fortune...';
            }
            const allFlippedDown = Array.from(document.querySelectorAll('.card')).every(card => !card.classList.contains('flipped'));
            if (allFlippedDown) {
                fortuneText = 'Choose your fortune...';
            }

            document.getElementById('fortune-text').textContent = fortuneText;
        });
    });
});