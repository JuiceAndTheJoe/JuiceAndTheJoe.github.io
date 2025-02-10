document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.addEventListener('click', function() {
            card.classList.toggle('flipped');
            const cardText = this.querySelector('.card-front').textContent;
            let fortuneText = '';
            let fortuneDesc = '';
            switch (cardText) {
            case '1':
                fortuneText = 'AOS';
                fortuneDesc = 'A student organization connecting students, institutions, and the defense sector.';
                break;
            case '2':
                fortuneText = 'On the Move with Daniel';
                fortuneDesc = 'A fitness and personal development project with my uncle.';
                break;
            case '3':
                fortuneText = 'Drawing App';
                fortuneDesc = 'A simple drawing app using HTML5 Canvas, CSS and JS.';
                break;
            default:
                fortuneText = 'Choose your fortune...';
            }
            const allFlippedDown = Array.from(document.querySelectorAll('.card')).every(card => !card.classList.contains('flipped'));
            if (allFlippedDown) {
                fortuneText = 'Choose your fortune...';
                fortuneDesc = '';
            }

            document.getElementById('fortune-text').textContent = fortuneText;
            document.getElementById('fortune-desc').textContent = fortuneDesc;
        });
    });
});