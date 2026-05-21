'use strict';

/* ═══════════════════════════════════════════
   GALLERY STATE
═══════════════════════════════════════════ */
let galleryData = [];
let galleryCreators = [];
let galleryArtists = [];
let galleryCurrentSort = 'latest';
let galleryActiveFilters = new Set();
let galleryFilterMode = null; // 'director' | 'tag' | 'artist' | null

/* ═══════════════════════════════════════════
   GALLERY INITIALIZATION
═══════════════════════════════════════════ */
function initGallery(rows, creators, artists) {
  galleryData = buildGalleryData(rows, creators, artists);
  galleryCreators = creators;
  galleryArtists = artists;
  galleryCurrentSort = 'latest';
  galleryActiveFilters.clear();
  galleryFilterMode = null;
  updateGalleryDisplay();
}

/* ═══════════════════════════════════════════
   BUILD GALLERY DATA FROM ROWS
═══════════════════════════════════════════ */
function buildGalleryData(rows, creators, artists) {
  const creatorMap = new Map(creators.map(c => [c.notionPageId, c]));
  const artistMap = new Map(artists.map(a => [a.notionPageId, a]));

  return rows.map((row, idx) => {
    const title = (row['Title'] || '').trim();
    const url = row['URL'] || '';
    const categoryStr = row['Category'] || '';
    const tags = categoryStr.split(',').map(t => t.trim()).filter(Boolean);
    const thumb = thumbUrl(url);
    const notionPageId = (row['_notionPageId'] || '').replace(/-/g, '');

    // Get directors/creators from creatorMap using notionPageId
    const directorIds = row._creatorRelIds || [];
    const directors = directorIds
      .map(id => {
        const normalizedId = id.replace(/-/g, '');
        return creatorMap.get(normalizedId);
      })
      .filter(Boolean);

    // Get artists
    const artistNames = xnames(row['Artist'] || '');
    const artsts = artistNames
      .map(name => {
        const meta = getCreatorMeta(name);
        return {
          Name: name,
          Role: meta.role,
          SNS: meta.sns,
          Avatar: meta.avatar,
          notionPageId: meta.notionPageId,
        };
      });

    return {
      id: `w${idx}`,
      title,
      url,
      thumb,
      tags,
      directors,
      artists: artsts,
      notionPageId,
      createdAt: new Date().getTime() - idx * 1000, // Fallback to index-based sorting
    };
  });
}

/* ═══════════════════════════════════════════
   GALLERY DISPLAY & RENDERING
═══════════════════════════════════════════ */
function updateGalleryDisplay() {
  const container = document.getElementById('gallery-content');
  const filteredData = getFilteredGalleryData();

  if (filteredData.length === 0) {
    container.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty-icon">📭</div>
        <div class="gallery-empty-text">作品がありません</div>
      </div>
    `;
    return;
  }

  if (galleryFilterMode === 'director' || galleryFilterMode === 'artist') {
    renderGroupedGallery(container, filteredData);
  } else {
    renderFlatGallery(container, filteredData);
  }
}

function getFilteredGalleryData() {
  let data = [...galleryData];

  // Apply filters only if specific filter selections are made
  if (galleryActiveFilters.size > 0) {
    if (galleryFilterMode === 'director') {
      data = data.filter(item =>
        item.directors.some(d => galleryActiveFilters.has(d.notionPageId))
      );
    } else if (galleryFilterMode === 'artist') {
      data = data.filter(item =>
        item.artists.some(a => galleryActiveFilters.has(a.notionPageId))
      );
    } else if (galleryFilterMode === 'tag') {
      data = data.filter(item =>
        item.tags.some(tag => galleryActiveFilters.has(tag))
      );
    }
  }

  // Apply sort
  if (galleryCurrentSort === 'latest') {
    data.sort((a, b) => b.createdAt - a.createdAt);
  } else if (galleryCurrentSort === 'oldest') {
    data.sort((a, b) => a.createdAt - b.createdAt);
  }

  return data;
}

function renderFlatGallery(container, data) {
  const grid = document.createElement('div');
  grid.id = 'gallery-grid';
  grid.className = 'gallery-grid';

  data.forEach(item => {
    const card = createGalleryCard(item);
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function renderGroupedGallery(container, data) {
  container.innerHTML = '';

  if (galleryFilterMode === 'director') {
    const grouped = new Map();
    data.forEach(item => {
      item.directors.forEach(director => {
        if (!grouped.has(director.Name)) {
          grouped.set(director.Name, []);
        }
        grouped.get(director.Name).push(item);
      });
    });

    const sortedGroups = [...grouped.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], 'ja')
    );

    sortedGroups.forEach(([directorName, items]) => {
      const group = createGalleryGroup(directorName, items, 'director');
      container.appendChild(group);
    });
  } else if (galleryFilterMode === 'artist') {
    const grouped = new Map();
    data.forEach(item => {
      item.artists.forEach(artist => {
        if (!grouped.has(artist.Name)) {
          grouped.set(artist.Name, []);
        }
        grouped.get(artist.Name).push(item);
      });
    });

    const sortedGroups = [...grouped.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], 'ja')
    );

    sortedGroups.forEach(([artistName, items]) => {
      const group = createGalleryGroup(artistName, items, 'artist');
      container.appendChild(group);
    });
  }
}

function createGalleryGroup(title, items, type) {
  const group = document.createElement('div');
  group.className = 'gallery-group';

  const titleEl = document.createElement('div');
  titleEl.className = 'gallery-group-title';
  titleEl.textContent = title;

  const countEl = document.createElement('div');
  countEl.className = 'gallery-group-subtitle';
  countEl.textContent = `${items.length}件の作品`;

  const grid = document.createElement('div');
  grid.className = 'gallery-group-grid';

  items.forEach(item => {
    const card = createGalleryCard(item);
    grid.appendChild(card);
  });

  group.appendChild(titleEl);
  group.appendChild(countEl);
  group.appendChild(grid);

  return group;
}

function createGalleryCard(item) {
  const card = document.createElement('div');
  card.className = 'gallery-card';

  // Thumbnail
  const thumb = document.createElement('div');
  thumb.className = 'gallery-card-thumb';
  if (item.thumb) {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = item.title;
    img.onerror = () => {
      thumb.innerHTML = '<div class="gallery-card-thumb-placeholder">🎬</div>';
    };
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = '<div class="gallery-card-thumb-placeholder">🎬</div>';
  }

  // Content
  const content = document.createElement('div');
  content.className = 'gallery-card-content';

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'gallery-card-title';
  titleEl.textContent = item.title;
  titleEl.title = item.title;

  // Credits
  const credits = document.createElement('div');
  credits.className = 'gallery-card-credits';

  // Directors
  if (item.directors.length > 0) {
    const dirRow = createCreditRow('監督', item.directors);
    credits.appendChild(dirRow);
  }

  // Artists
  if (item.artists.length > 0) {
    const artRow = createCreditRow('出演', item.artists);
    credits.appendChild(artRow);
  }

  // Tags
  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'gallery-card-tags';
  item.tags.forEach(tag => {
    const tagEl = document.createElement('div');
    tagEl.className = 'gallery-card-tag';
    tagEl.textContent = tag;
    tagsContainer.appendChild(tagEl);
  });

  content.appendChild(titleEl);
  content.appendChild(credits);
  if (item.tags.length > 0) {
    content.appendChild(tagsContainer);
  }

  // URL click handler
  card.style.cursor = item.url ? 'pointer' : 'default';
  if (item.url) {
    card.addEventListener('click', () => {
      window.open(item.url, '_blank');
    });
  }

  card.appendChild(thumb);
  card.appendChild(content);

  return card;
}

function createCreditRow(label, people) {
  const row = document.createElement('div');
  row.className = 'gallery-card-credit-row';

  const labelEl = document.createElement('div');
  labelEl.className = 'gallery-card-credit-label';
  labelEl.textContent = label;

  const iconsContainer = document.createElement('div');
  iconsContainer.className = 'gallery-card-credit-icons';

  const namesContainer = document.createElement('div');
  namesContainer.className = 'gallery-card-credit-names';

  people.slice(0, 2).forEach((person, idx) => {
    const avatar = document.createElement('div');
    avatar.className = 'gallery-card-avatar';
    if (person.Avatar) {
      const img = document.createElement('img');
      img.src = person.Avatar;
      img.alt = person.Name;
      img.onerror = () => {
        avatar.innerHTML =
          '<div class="gallery-card-avatar-placeholder">👤</div>';
      };
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = '<div class="gallery-card-avatar-placeholder">👤</div>';
    }
    iconsContainer.appendChild(avatar);

    if (idx === 0) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'gallery-card-credit-name';
      nameSpan.textContent = person.Name;
      nameSpan.title = person.Name;
      namesContainer.appendChild(nameSpan);
    }
  });

  if (people.length > 2) {
    const moreSpan = document.createElement('span');
    moreSpan.className = 'gallery-card-credit-name';
    moreSpan.textContent = `+${people.length - 2}`;
    moreSpan.title = people.map(p => p.Name).join(', ');
    namesContainer.appendChild(moreSpan);
  }

  row.appendChild(labelEl);
  row.appendChild(iconsContainer);
  row.appendChild(namesContainer);

  return row;
}

/* ═══════════════════════════════════════════
   GALLERY CONTROLS
═══════════════════════════════════════════ */
function setupGalleryControls() {
  // Sort buttons
  const sortLatest = document.getElementById('gallery-sort-latest');
  const sortOldest = document.getElementById('gallery-sort-oldest');

  if (sortLatest) {
    sortLatest.addEventListener('click', () => {
      galleryCurrentSort = 'latest';
      updateGalleryControlUI();
      updateGalleryDisplay();
    });
  }

  if (sortOldest) {
    sortOldest.addEventListener('click', () => {
      galleryCurrentSort = 'oldest';
      updateGalleryControlUI();
      updateGalleryDisplay();
    });
  }

  // Filter buttons
  const filterDirector = document.getElementById('gallery-filter-director');
  const filterTag = document.getElementById('gallery-filter-tag');
  const filterArtist = document.getElementById('gallery-filter-artist');
  const filterBtn = document.getElementById('gallery-filter-btn');
  const filterDropdown = document.getElementById('gallery-filter-dropdown');

  const setupFilterMode = (mode, btn) => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        if (galleryFilterMode === mode) {
          galleryFilterMode = null;
          galleryActiveFilters.clear();
        } else {
          galleryFilterMode = mode;
          galleryActiveFilters.clear();
        }
        updateGalleryControlUI();
        renderFilterDropdown();
        toggleFilterDropdown(e);
      });
    }
  };

  setupFilterMode('director', filterDirector);
  setupFilterMode('tag', filterTag);
  setupFilterMode('artist', filterArtist);

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (
      filterDropdown &&
      !filterDropdown.contains(e.target) &&
      !filterBtn.contains(e.target) &&
      !filterDirector?.contains(e.target) &&
      !filterTag?.contains(e.target) &&
      !filterArtist?.contains(e.target)
    ) {
      filterDropdown.classList.remove('open');
    }
  });
}

function toggleFilterDropdown(e) {
  const filterDropdown = document.getElementById('gallery-filter-dropdown');
  if (filterDropdown) {
    filterDropdown.classList.toggle('open');
    if (filterDropdown.classList.contains('open') && e) {
      const btn = e.target.closest('button');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        filterDropdown.style.top = rect.bottom + 4 + 'px';
        filterDropdown.style.left = Math.max(0, rect.left) + 'px';
      }
    }
  }
}

function renderFilterDropdown() {
  const dropdown = document.getElementById('gallery-filter-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '';

  if (galleryFilterMode === 'director') {
    const directors = [...new Set(galleryData.flatMap(d => d.directors))];
    directors.sort((a, b) => a.Name.localeCompare(b.Name, 'ja'));

    directors.forEach(director => {
      const item = document.createElement('div');
      item.className = 'gallery-filter-item';
      if (galleryActiveFilters.has(director.notionPageId)) {
        item.classList.add('checked');
      }

      const check = document.createElement('div');
      check.className = 'gallery-filter-check';

      const label = document.createElement('span');
      label.textContent = director.Name;

      item.appendChild(check);
      item.appendChild(label);

      item.addEventListener('click', () => {
        if (galleryActiveFilters.has(director.notionPageId)) {
          galleryActiveFilters.delete(director.notionPageId);
        } else {
          galleryActiveFilters.add(director.notionPageId);
        }
        renderFilterDropdown();
        updateGalleryDisplay();
      });

      dropdown.appendChild(item);
    });
  } else if (galleryFilterMode === 'tag') {
    const tags = [...new Set(galleryData.flatMap(d => d.tags))];
    tags.sort();

    tags.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'gallery-filter-item';
      if (galleryActiveFilters.has(tag)) {
        item.classList.add('checked');
      }

      const check = document.createElement('div');
      check.className = 'gallery-filter-check';

      const label = document.createElement('span');
      label.textContent = tag;

      item.appendChild(check);
      item.appendChild(label);

      item.addEventListener('click', () => {
        if (galleryActiveFilters.has(tag)) {
          galleryActiveFilters.delete(tag);
        } else {
          galleryActiveFilters.add(tag);
        }
        renderFilterDropdown();
        updateGalleryDisplay();
      });

      dropdown.appendChild(item);
    });
  } else if (galleryFilterMode === 'artist') {
    const artists = [...new Set(galleryData.flatMap(d => d.artists))];
    artists.sort((a, b) => a.Name.localeCompare(b.Name, 'ja'));

    artists.forEach(artist => {
      const item = document.createElement('div');
      item.className = 'gallery-filter-item';
      if (galleryActiveFilters.has(artist.notionPageId)) {
        item.classList.add('checked');
      }

      const check = document.createElement('div');
      check.className = 'gallery-filter-check';

      const label = document.createElement('span');
      label.textContent = artist.Name;

      item.appendChild(check);
      item.appendChild(label);

      item.addEventListener('click', () => {
        if (galleryActiveFilters.has(artist.notionPageId)) {
          galleryActiveFilters.delete(artist.notionPageId);
        } else {
          galleryActiveFilters.add(artist.notionPageId);
        }
        renderFilterDropdown();
        updateGalleryDisplay();
      });

      dropdown.appendChild(item);
    });
  }
}

function updateGalleryControlUI() {
  const sortLatest = document.getElementById('gallery-sort-latest');
  const sortOldest = document.getElementById('gallery-sort-oldest');
  const filterDirector = document.getElementById('gallery-filter-director');
  const filterTag = document.getElementById('gallery-filter-tag');
  const filterArtist = document.getElementById('gallery-filter-artist');

  // Update sort button states
  if (sortLatest) {
    sortLatest.classList.toggle('active', galleryCurrentSort === 'latest');
  }
  if (sortOldest) {
    sortOldest.classList.toggle('active', galleryCurrentSort === 'oldest');
  }

  // Update filter button states
  if (filterDirector) {
    filterDirector.classList.toggle('active', galleryFilterMode === 'director');
  }
  if (filterTag) {
    filterTag.classList.toggle('active', galleryFilterMode === 'tag');
  }
  if (filterArtist) {
    filterArtist.classList.toggle('active', galleryFilterMode === 'artist');
  }
}
