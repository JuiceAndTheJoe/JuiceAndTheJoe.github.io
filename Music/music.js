// Track data - All covers from Cakewalk Projects
const tracks = [
    // Spanish/Latin covers
    {
        title: "Como te olvido",
        artist: "Jose Velasquez",
        genre: "latin",
        album: "Covers",
        src: "tracks/Como te olvido.mp3",
        cover: null
    },
    {
        title: "Como te olvido (Instrumental)",
        artist: "Jose Velasquez",
        genre: "latin",
        album: "Covers",
        src: "tracks/Como te olvido fondo.mp3",
        cover: null
    },
    {
        title: "Penas de un soldado",
        artist: "Jose Velasquez",
        genre: "latin",
        album: "Covers",
        src: "tracks/Penas de un soldado.mp3",
        cover: null
    },
    {
        title: "Realizame mis sueños",
        artist: "Jose Velasquez",
        genre: "latin",
        album: "Covers",
        src: "tracks/Realizame mis sueños.mp3",
        cover: null
    },
    {
        title: "Welcome to Dirt / Amor Libre",
        artist: "Jose Velasquez",
        genre: "latin",
        album: "Covers",
        src: "tracks/welcome to dirt - amor libre.mp3",
        cover: null
    },

    // Swedish covers
    {
        title: "Vi som älskat förut",
        artist: "Jose Velasquez",
        genre: "swedish",
        album: "Covers",
        src: "tracks/vi som älskat förut.mp3",
        cover: null
    },
    {
        title: "Älskat förut",
        artist: "Jose Velasquez",
        genre: "swedish",
        album: "Covers",
        src: "tracks/alskat forut.mp3",
        cover: null
    },
    {
        title: "Inkomplett",
        artist: "Jose Velasquez",
        genre: "swedish",
        album: "Covers",
        src: "tracks/inkomplett.mp3",
        cover: null
    },
    {
        title: "Tillsammans igen",
        artist: "Jose Velasquez",
        genre: "swedish",
        album: "Covers",
        src: "tracks/Tillsammans igen.mp3",
        cover: null
    },

    // English covers
    {
        title: "Gasque of It",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/gasque of it.mp3",
        cover: null
    },
    {
        title: "I'm So Lonesome I Could Cry",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/im so lonesome.mp3",
        cover: null
    },
    {
        title: "In the Stars",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/in the stars.mp3",
        cover: null
    },
    {
        title: "Leif Erikson",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/Leif Erikson.mp3",
        cover: null
    },
    {
        title: "Nobody Home",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/Nobody Home.mp3",
        cover: null
    },
    {
        title: "Stuck on You",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/Stuck on you.mp3",
        cover: null
    },
    {
        title: "Tomorrow Night",
        artist: "Jose Velasquez",
        genre: "english",
        album: "Covers",
        src: "tracks/tomorrow night.mp3",
        cover: null
    },

    // Fragments & Experiments
    {
        title: "In the Stars (Chorus)",
        artist: "Jose Velasquez",
        genre: "fragment",
        album: "Experiments",
        src: "tracks/chorus.mp3",
        cover: null
    },
    {
        title: "Guitar Experiment 1",
        artist: "Jose Velasquez",
        genre: "fragment",
        album: "Experiments",
        src: "tracks/guit_1.mp3",
        cover: null
    },
    {
        title: "Guitar Experiment 2",
        artist: "Jose Velasquez",
        genre: "fragment",
        album: "Experiments",
        src: "tracks/guit_2.mp3",
        cover: null
    },
    {
        title: "Guitar Experiment 3",
        artist: "Jose Velasquez",
        genre: "fragment",
        album: "Experiments",
        src: "tracks/guit_3.mp3",
        cover: null
    }
];

// State
let currentTrackIndex = -1;
let wavesurfer = null;
let isPlaying = false;
let isShuffleOn = false;
let isRepeatOn = false;
let shuffledIndices = [];

// DOM Elements
const albumGrid = document.getElementById('album-grid');
const playerCover = document.getElementById('player-cover');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');
const volumeBar = document.getElementById('volume-bar');
const volumeBtn = document.getElementById('volume-btn');
const filterPills = document.querySelectorAll('.filter-pill');
const mainPlayBtn = document.getElementById('main-play-btn');
const shuffleBtn = document.getElementById('shuffle-btn');
const shuffleToggle = document.getElementById('shuffle-toggle');
const repeatBtn = document.getElementById('repeat-btn');
const trackCountEl = document.getElementById('track-count');

// Sidebar playlist clicks
const playlistItems = document.querySelectorAll('.playlist-item');

// Initialize WaveSurfer
function initWaveSurfer() {
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: 'rgba(255, 255, 255, 0.3)',
        progressColor: '#1DB954',
        cursorColor: 'transparent',
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: 40,
        responsive: true,
        normalize: true
    });

    wavesurfer.on('ready', () => {
        totalTimeEl.textContent = formatTime(wavesurfer.getDuration());
        if (isPlaying) {
            wavesurfer.play();
        }
    });

    wavesurfer.on('audioprocess', () => {
        currentTimeEl.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seeking', () => {
        currentTimeEl.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
        if (isRepeatOn) {
            wavesurfer.seekTo(0);
            wavesurfer.play();
        } else {
            playNext();
        }
    });

    wavesurfer.on('play', () => {
        isPlaying = true;
        updatePlayPauseIcon();
        updateCardStates();
    });

    wavesurfer.on('pause', () => {
        isPlaying = false;
        updatePlayPauseIcon();
        updateCardStates();
    });
}

// Format time in MM:SS
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update play/pause button icons
function updatePlayPauseIcon() {
    // Bottom player
    const icon = playPauseBtn.querySelector('i');
    icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    playPauseBtn.classList.toggle('paused', !isPlaying);

    // Main play button
    const mainIcon = mainPlayBtn.querySelector('i');
    mainIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

// Update card states
function updateCardStates() {
    document.querySelectorAll('.album-card').forEach(card => {
        const index = parseInt(card.dataset.index);
        const isCurrentTrack = index === currentTrackIndex;
        card.classList.toggle('playing', isCurrentTrack && isPlaying);

        const playBtn = card.querySelector('.album-play-btn i');
        if (isCurrentTrack) {
            playBtn.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
        } else {
            playBtn.className = 'fas fa-play';
        }
    });
}

// Generate shuffle order
function generateShuffleOrder() {
    shuffledIndices = [...Array(tracks.length).keys()];
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }
}

// Get next track index
function getNextIndex() {
    if (isShuffleOn) {
        const currentShufflePos = shuffledIndices.indexOf(currentTrackIndex);
        const nextPos = (currentShufflePos + 1) % shuffledIndices.length;
        return shuffledIndices[nextPos];
    }
    return (currentTrackIndex + 1) % tracks.length;
}

// Get previous track index
function getPrevIndex() {
    if (isShuffleOn) {
        const currentShufflePos = shuffledIndices.indexOf(currentTrackIndex);
        const prevPos = (currentShufflePos - 1 + shuffledIndices.length) % shuffledIndices.length;
        return shuffledIndices[prevPos];
    }
    return (currentTrackIndex - 1 + tracks.length) % tracks.length;
}

// Get genre icon
function getGenreIcon(genre) {
    switch (genre) {
        case 'latin': return 'fa-guitar';
        case 'swedish': return 'fa-snowflake';
        case 'english': return 'fa-microphone';
        case 'fragment': return 'fa-flask';
        default: return 'fa-music';
    }
}

// Get genre color
function getGenreColor(genre) {
    switch (genre) {
        case 'latin': return '#f59e0b';
        case 'swedish': return '#3b82f6';
        case 'english': return '#8b5cf6';
        case 'fragment': return '#6b7280';
        default: return '#1DB954';
    }
}

// Render album cards
function renderTracks(filter = 'all') {
    albumGrid.innerHTML = '';

    const filteredTracks = filter === 'all'
        ? tracks
        : tracks.filter(track => track.genre === filter);

    if (filteredTracks.length === 0) {
        albumGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--spotify-text-muted);">
                <i class="fas fa-music" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;"></i>
                <h3 style="font-size: 1.5rem; margin-bottom: 10px; color: var(--spotify-text);">No tracks found</h3>
                <p>No tracks match this filter.</p>
            </div>
        `;
        return;
    }

    filteredTracks.forEach((track) => {
        const originalIndex = tracks.indexOf(track);
        const card = document.createElement('div');
        card.className = `album-card${originalIndex === currentTrackIndex ? ' playing' : ''}`;
        card.dataset.index = originalIndex;

        const genreColor = getGenreColor(track.genre);
        const genreIcon = getGenreIcon(track.genre);

        const coverHtml = track.cover
            ? `<img src="${track.cover}" alt="${track.title}" class="album-cover">`
            : `<div class="album-cover-placeholder" style="background: linear-gradient(135deg, ${genreColor}33 0%, ${genreColor}11 100%);">
                <i class="fas ${genreIcon}" style="color: ${genreColor};"></i>
               </div>`;

        card.innerHTML = `
            <div class="album-cover-wrapper">
                ${coverHtml}
                <button class="album-play-btn">
                    <i class="fas ${originalIndex === currentTrackIndex && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                </button>
            </div>
            <div class="album-title">${track.title}</div>
            <div class="album-description">${track.artist}</div>
            <span class="album-genre" style="color: ${genreColor}; background: ${genreColor}22;">${track.genre}</span>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.album-play-btn')) {
                e.stopPropagation();
            }

            if (originalIndex === currentTrackIndex) {
                togglePlayPause();
            } else {
                loadTrack(originalIndex);
                isPlaying = true;
            }
        });

        albumGrid.appendChild(card);
    });

    // Update track count
    const displayCount = filter === 'all' ? tracks.length : filteredTracks.length;
    trackCountEl.textContent = `${displayCount} track${displayCount !== 1 ? 's' : ''}`;
}

// Load a track
function loadTrack(index) {
    if (index < 0 || index >= tracks.length) return;

    currentTrackIndex = index;
    const track = tracks[index];

    // Update player info
    playerTitle.textContent = track.title;
    playerArtist.textContent = track.artist;

    // Update cover
    const genreColor = getGenreColor(track.genre);
    const genreIcon = getGenreIcon(track.genre);

    if (track.cover) {
        playerCover.innerHTML = `<img src="${track.cover}" alt="${track.title}" class="now-playing-cover">`;
    } else {
        playerCover.innerHTML = `
            <div class="now-playing-placeholder" style="background: linear-gradient(135deg, ${genreColor}44, ${genreColor}22);">
                <i class="fas ${genreIcon}" style="color: ${genreColor};"></i>
            </div>`;
    }

    // Load audio into wavesurfer
    wavesurfer.load(track.src);

    // Update card states
    updateCardStates();
}

// Toggle play/pause
function togglePlayPause() {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        loadTrack(isShuffleOn ? shuffledIndices[0] : 0);
        isPlaying = true;
        return;
    }

    wavesurfer.playPause();
}

// Play previous track
function playPrev() {
    if (tracks.length === 0) return;

    // If more than 3 seconds in, restart track
    if (wavesurfer && wavesurfer.getCurrentTime() > 3) {
        wavesurfer.seekTo(0);
        return;
    }

    loadTrack(getPrevIndex());
    isPlaying = true;
}

// Play next track
function playNext() {
    if (tracks.length === 0) return;
    loadTrack(getNextIndex());
    isPlaying = true;
}

// Handle filter clicks
function handleFilter(e) {
    const genre = e.target.dataset.genre;
    filterPills.forEach(pill => pill.classList.toggle('active', pill === e.target));

    // Also update sidebar active state
    playlistItems.forEach(item => {
        const name = item.querySelector('.playlist-name').textContent.toLowerCase();
        if (genre === 'all' && name === 'all songs') {
            item.classList.add('active');
        } else if (name === genre) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    renderTracks(genre);
}

// Handle volume change
function handleVolumeChange(e) {
    const volume = e.target.value / 100;
    if (wavesurfer) {
        wavesurfer.setVolume(volume);
    }
    volumeBar.style.width = `${e.target.value}%`;
    updateVolumeIcon(volume);
}

// Update volume icon
function updateVolumeIcon(volume) {
    const icon = volumeBtn.querySelector('i');
    if (volume === 0) {
        icon.className = 'fas fa-volume-mute';
    } else if (volume < 0.5) {
        icon.className = 'fas fa-volume-down';
    } else {
        icon.className = 'fas fa-volume-up';
    }
}

// Toggle shuffle
function toggleShuffle() {
    isShuffleOn = !isShuffleOn;
    shuffleBtn.classList.toggle('active', isShuffleOn);
    shuffleToggle.classList.toggle('active', isShuffleOn);

    if (isShuffleOn) {
        generateShuffleOrder();
    }
}

// Toggle repeat
function toggleRepeat() {
    isRepeatOn = !isRepeatOn;
    repeatBtn.classList.toggle('active', isRepeatOn);
}

// Toggle mute
let previousVolume = 80;
function toggleMute() {
    if (wavesurfer.getVolume() > 0) {
        previousVolume = volumeSlider.value;
        volumeSlider.value = 0;
        volumeBar.style.width = '0%';
        wavesurfer.setVolume(0);
        updateVolumeIcon(0);
    } else {
        volumeSlider.value = previousVolume;
        volumeBar.style.width = `${previousVolume}%`;
        wavesurfer.setVolume(previousVolume / 100);
        updateVolumeIcon(previousVolume / 100);
    }
}

// Handle sidebar playlist clicks
function handlePlaylistClick(e) {
    const item = e.currentTarget;
    const name = item.querySelector('.playlist-name').textContent.toLowerCase();

    // Map playlist name to genre
    let genre = 'all';
    if (name === 'latin') genre = 'latin';
    else if (name === 'swedish') genre = 'swedish';
    else if (name === 'english') genre = 'english';
    else if (name === 'fragments') genre = 'fragment';

    // Update filter pills
    filterPills.forEach(pill => {
        pill.classList.toggle('active', pill.dataset.genre === genre);
    });

    // Update sidebar
    playlistItems.forEach(pl => pl.classList.remove('active'));
    item.classList.add('active');

    renderTracks(genre);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initWaveSurfer();
    generateShuffleOrder();
    renderTracks();

    // Event listeners
    playPauseBtn.addEventListener('click', togglePlayPause);
    mainPlayBtn.addEventListener('click', togglePlayPause);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    volumeSlider.addEventListener('input', handleVolumeChange);
    volumeBtn.addEventListener('click', toggleMute);
    filterPills.forEach(pill => pill.addEventListener('click', handleFilter));
    shuffleBtn.addEventListener('click', toggleShuffle);
    shuffleToggle.addEventListener('click', toggleShuffle);
    repeatBtn.addEventListener('click', toggleRepeat);

    // Sidebar playlist clicks
    playlistItems.forEach(item => {
        item.addEventListener('click', handlePlaylistClick);
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                if (e.shiftKey) {
                    playPrev();
                } else if (wavesurfer) {
                    wavesurfer.skip(-10);
                }
                break;
            case 'ArrowRight':
                if (e.shiftKey) {
                    playNext();
                } else if (wavesurfer) {
                    wavesurfer.skip(10);
                }
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'KeyS':
                toggleShuffle();
                break;
            case 'KeyR':
                toggleRepeat();
                break;
        }
    });

    // Set initial volume bar width
    volumeBar.style.width = `${volumeSlider.value}%`;
});
