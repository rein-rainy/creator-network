/* ═══════════════════════════════════════════
   INFO PANEL
═══════════════════════════════════════════ */
function showPanel(d) {
  const col = d.type === 'director' ? 'var(--node-dir)' : d.type === 'artist' ? 'var(--node-art)' : 'var(--accent2)';
  const lbl = d.type === 'director' ? 'CREATOR' : d.type === 'artist' ? 'ARTIST' : 'WORK';
  document.getElementById('pt').textContent = lbl;
  document.getElementById('pt').style.color = col;

  const pnEl = document.getElementById('pn');
  pnEl.textContent = d.label;

  // クリエイター / アーティストのみ: ダブルクリックで名前を編集
  pnEl.ondblclick = null;
  if (d.type === 'director' || d.type === 'artist') {
    pnEl.title = 'ダブルクリックで名前を編集';
    pnEl.style.cursor = 'text';
    pnEl.ondblclick = () => {
      if (pnEl.querySelector('input')) return;
      const oldName = d.label;
      const input = document.createElement('input');
      input.value = oldName;
      input.style.cssText = [
        'font:inherit', 'font-size:inherit', 'font-weight:inherit',
        'color:var(--text)', 'background:var(--bg3)',
        'border:1.5px solid var(--accent)', 'border-radius:6px',
        'padding:2px 6px', 'outline:none',
        'width:100%', 'box-sizing:border-box',
      ].join(';');
      pnEl.textContent = '';
      pnEl.appendChild(input);
      input.focus();
      input.select();

      let committed = false;
      async function commitRename() {
        if (committed) return;
        committed = true;
        const newName = input.value.trim();
        pnEl.textContent = newName || oldName;
        if (!newName || newName === oldName) return;

        // サイト内のノードデータを即時更新
        const node = AN.find(n => n.id === d.id);
        if (node) {
          node.label = newName;
          d.label = newName;
          d3.selectAll('foreignObject').each(function(nd) {
            if (nd && nd.id === d.id) {
              d3.select(this).select('.pnode-name').text(newName);
            }
          });
        }

        if (!d.notionPageId) {
          console.warn('[Rename] notionPageId がありません');
          return;
        }
        try {
          const r = await fetch('/notion-rename-creator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creatorPageId: d.notionPageId, newName }),
          });
          const json = await r.json();
          if (!json.success) throw new Error(json.error || '更新失敗');
          console.log('[Rename] Notion 更新完了: "' + newName + '"');
        } catch (e) {
          console.error('[Rename] Notion 更新エラー:', e.message);
        }
      }

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') { committed = true; pnEl.textContent = oldName; }
      });
      input.addEventListener('blur', commitRename);
    };
  } else {
    pnEl.title = '';
    pnEl.style.cursor = '';
  }

  // IMDB panel ID（work用、関数スコープで管理）
  let _imdbPanelId = null;

  // ph アバター更新
  const phAvatar = document.getElementById('ph-avatar');
  if (d.type === 'work') {
    phAvatar.style.display = 'none';
  } else {
    phAvatar.style.display = 'flex';
    phAvatar.style.background = col;
    phAvatar.innerHTML = '';
    const initial = [...d.label][0] || '?';
    if (d.avatar) {
      const img = document.createElement('img');
      img.src = d.avatar; img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      img.onerror = () => { phAvatar.innerHTML = initial; };
      phAvatar.appendChild(img);
    } else {
      phAvatar.textContent = initial;
    }
  }

  const panel = document.getElementById('info-panel');
  const overlay = document.getElementById('info-overlay');

  // work → 中央モーダル / person → 右上小パネル
  if (d.type === 'work') {
    panel.classList.add('mode-modal');
    panel.classList.remove('mode-side');
    overlay.classList.add('visible');
  } else {
    panel.classList.add('mode-side');
    panel.classList.remove('mode-modal');
    overlay.classList.remove('visible');
  }

  const hideBtn = document.getElementById('pc-hide');
  const searchBtn = document.getElementById('pc-search');
  const notionBtn = document.getElementById('pc-notion');
  if (d.type === 'work') {
    hideBtn.style.display = 'none';
    searchBtn.style.display = 'none';
    if (d.notionPageId) {
      notionBtn.style.display = 'flex';
      notionBtn.onclick = () => {
        window.open('https://www.notion.so/' + d.notionPageId, '_blank');
      };
    } else {
      notionBtn.style.display = 'none';
    }
  } else {
    notionBtn.style.display = 'none';
    hideBtn.style.display = 'flex';
    searchBtn.style.display = 'flex';
    hideBtn.onclick = () => {
      stopYtIframe();
      hiddenIds.add(d.id); updateHiddenUI(); refresh();
      panel.classList.remove('visible');
      overlay.classList.remove('visible');
      selId = null;
    };
    searchBtn.onclick = () => {
      openFilmographyModal(d.label, d.avatar || '');
    };
  }

  let html = '';
  if (d.type === 'work') {
    const vid = ytid(d.url);
    if (vid) {
      html += `<div style="position:relative;width:100%;padding-top:56.25%;border-bottom:1px solid var(--border);background:#000">`;
      html += `<iframe id="yt-iframe" src="https://www.youtube.com/embed/${esc(vid)}?autoplay=0&modestbranding=1&rel=0&iv_load_policy=3" style="position:absolute;inset:0;width:100%;height:100%;border:none" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      html += `</div>`;
    } else if (d.th) {
      html += `<img style="width:100%;height:130px;object-fit:cover;border-bottom:1px solid var(--border);display:block" src="${esc(d.th)}" onerror="this.style.display='none'">`;
    }
    html += `<div style="padding:14px 20px 10px">`;
    html += (d.cats || []).map(c => `<span class="wc-tag" style="margin-right:5px;margin-bottom:5px;display:inline-block;font-size:12px;padding:4px 10px">${esc(c)}</span>`).join('');
    html += `</div>`;

    // --- 参加クリエイター（director）横スクロールカード ---
    const workPersons = [];
    AL.forEach(l => {
      const s = lid(l.source), t = lid(l.target);
      if (s === d.id || t === d.id) {
        const personId = s === d.id ? t : s;
        const person = AN.find(n => n.id === personId && n.type === 'director');
        if (person && !workPersons.find(p => p.person.id === person.id))
          workPersons.push({ person });
      }
    });
    workPersons.sort((a, b) => {
      // スコア: アイコンあり & 名前ロール一致=0, アイコンあり=1, 名前ロール一致=2, 残り=3
      function personScore(p) {
        const hasAvatar = !!(p.avatar);
        const hasRole   = !!(p.role && p.role.trim());
        if (hasAvatar && hasRole) return 0;
        if (hasAvatar)            return 1;
        if (hasRole)              return 2;
        return 3;
      }
      const sa = personScore(a.person), sb = personScore(b.person);
      if (sa !== sb) return sa - sb;
      // スコアが同じ場合: ロール名でグループ化してから名前順
      const ra = a.person.role || '', rb = b.person.role || '';
      if (ra !== rb) return ra.localeCompare(rb, 'ja');
      return a.person.label.localeCompare(b.person.label, 'ja');
    });
    if (workPersons.length || true) {
      html += `<div style="border-top:1px solid var(--border);padding:10px 14px 14px">`;
      html += `<div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-dim);padding:2px 0 10px;display:flex;justify-content:space-between;align-items:center">
        <span>参加クリエイター</span>
        <button id="add-creator-btn" style="width:22px;height:22px;border-radius:50%;border:none;background:var(--bg3);color:var(--text-2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s" title="クリエイターを追加" onmouseover="this.style.background='var(--accent)';this.style.color='#fff'" onmouseout="this.style.background='var(--bg3)';this.style.color='var(--text-2)'">＋</button>
      </div>`;
      if (workPersons.length) {
        html += `<div style="display:flex;gap:8px;overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:8px 2px">`;
        workPersons.forEach(({ person }) => {
          const roleText  = person.role || 'Creator';
          const initial   = [...person.label][0] || '?';
          const avatarUrl = person.avatar || '';
          const avatarInner = avatarUrl
            ? `<img src="${esc(avatarUrl)}" alt=""
                 style="width:100%;height:100%;object-fit:cover"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
               ><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">${esc(initial)}</span>`
            : `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">${esc(initial)}</span>`;
          html += `<div class="work-person-wrap" data-person-id="${esc(person.id)}" data-notion-page-id="${esc(person.notionPageId || '')}"
              style="position:relative;display:inline-flex;flex-shrink:0"
              onmouseenter="this.querySelector('.remove-creator-btn').style.opacity='1';this.querySelector('.remove-creator-btn').style.pointerEvents='auto'"
              onmouseleave="this.querySelector('.remove-creator-btn').style.opacity='0';this.querySelector('.remove-creator-btn').style.pointerEvents='none'">
            <button class="work-person-btn" data-person-id="${esc(person.id)}"
              style="display:inline-flex;flex-direction:row;align-items:center;gap:10px;
                     width:fit-content;max-width:200px;flex-shrink:0;
                     background:var(--card-bg);border:1.5px solid var(--card-border);border-radius:var(--r);
                     padding:10px 12px;cursor:pointer;text-align:left;transition:all .15s"
              onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--bg2)'"
              onmouseout="this.style.borderColor='var(--card-border)';this.style.background='var(--card-bg)'">
              <div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;
                          background:var(--node-dir);overflow:hidden;
                          display:flex;align-items:center;justify-content:center">
                ${avatarInner}
              </div>
              <div style="min-width:0;overflow:hidden">
                <div style="font-size:11px;font-weight:700;color:var(--text);
                            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                            line-height:1.4;margin-bottom:2px">${esc(person.label)}</div>
                <div style="font-size:10px;font-weight:500;color:var(--text-2);
                            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                            line-height:1.3">${esc(roleText)}</div>
              </div>
            </button>
            <button class="remove-creator-btn" data-person-id="${esc(person.id)}" data-person-name="${esc(person.label)}" title="${esc(person.label)}を削除"
              onmouseover="this.style.background='var(--accent-red)';this.style.color='#fff'"
              onmouseout="this.style.background='var(--bg3)';this.style.color='var(--text-2)'"
              style="position:absolute;top:-7px;right:-7px;width:18px;height:18px;
                     border-radius:50%;border:1.5px solid var(--bg2);background:var(--bg3);color:var(--text-2);
                     cursor:pointer;display:flex;align-items:center;justify-content:center;
                     box-shadow:0 1px 4px rgba(0,0,0,.4);transition:background .15s,opacity .15s;z-index:10;
                     padding:0;opacity:0;pointer-events:none">
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/>
              </svg>
            </button>
          </div>`;
        });
        html += `</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--text-dim);padding:4px 0 8px">紐づいているクリエイターはいません</div>`;
      }
      html += `</div>`;
    }

    // IMDB セクション（パネルオープン時に自動取得）
    _imdbPanelId = `imdb_${Date.now()}`;
    html += `<div id="imdb-section-${esc(_imdbPanelId)}" class="imdb-section">
      <div class="imdb-section-title">
        <span>IMDb 情報</span>
        <span class="imdb-badge">IMDb</span>
      </div>
      <div id="imdb-found-${esc(_imdbPanelId)}"></div>
      <div id="imdb-body-${esc(_imdbPanelId)}">
        <div class="imdb-loading">
          <div class="imdb-loading-dot"></div>
          <div class="imdb-loading-dot"></div>
          <div class="imdb-loading-dot"></div>
        </div>
      </div>
    </div>`;
  } else {
    const works = (d.works || []).map(wid => AN.find(n => n.id === wid)).filter(Boolean);
    const sl = d.type === 'director' ? `制作作品 (${works.length})` : `出演作品 (${works.length})`;

    // --- 役職 / SNS リンク（常に表示、編集ボタン付き）---
    const metaId = `cmeta_${d.id.replace(/[^a-z0-9]/gi,'_')}`;
    html += `<div id="${esc(metaId)}" class="cmeta-section">`;

    // 役職行（multi_select: カンマ区切り文字列 → 複数チップ表示）
    const roleChipsHtml = (() => {
      if (!d.role || !d.role.trim()) return `<span class="cmeta-empty" id="${esc(metaId)}_role_chip">未設定</span>`;
      const roleArr = d.role.split(',').map(r => r.trim()).filter(Boolean);
      const chips = roleArr.map(r => `<span class="cmeta-role-chip">${esc(r)}</span>`).join('');
      return `<span id="${esc(metaId)}_role_chip" style="display:flex;flex-wrap:wrap;gap:4px">${chips}</span>`;
    })();
    html += `<div class="cmeta-row" id="${esc(metaId)}_role_view">
      <span class="cmeta-label">役職</span>
      ${roleChipsHtml}
      <button class="cmeta-edit-btn" id="${esc(metaId)}_role_editbtn" title="役職を編集">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>`;

    // SNS行
    html += `<div id="${esc(metaId)}_sns_view">
      <div class="cmeta-row">
        <span class="cmeta-label">SNS</span>
        <div style="display:flex;flex-wrap:wrap;gap:5px;flex:1;min-width:0" id="${esc(metaId)}_sns_chips">`;
    if (d.sns && d.sns.length > 0) {
      d.sns.forEach(s => {
        html += `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="cmeta-sns-chip">${esc(s.label)}</a>`;
      });
    } else {
      html += `<span class="cmeta-empty">未設定</span>`;
    }
    html += `</div>
        <button class="cmeta-edit-btn" id="${esc(metaId)}_sns_editbtn" title="SNSを編集">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
    </div>`;

    html += `</div>`; // cmeta-section end

    // --- Top co-workers (非表示ノードを除外) ---
    const counterType = d.type === 'director' ? 'artist' : 'director';
    const counterLabel = d.type === 'director' ? '担当アーティスト TOP 3' : '担当クリエイター TOP 3';
    const countMap = new Map();
    works.forEach(w => {
      AL.forEach(l => {
        const s = lid(l.source), t = lid(l.target);
        const isThisWork = s === w.id || t === w.id;
        if (!isThisWork) return;
        const peerId = s === w.id ? t : s;
        const peer = AN.find(n => n.id === peerId && n.type === counterType);
        if (!peer) return;
        if (hiddenIds.has(peer.id)) return;
        countMap.set(peer.id, { label: peer.label, count: (countMap.get(peer.id)?.count || 0) + 1 });
      });
    });
    const allCoworkers = [...countMap.values()].sort((a, b) => b.count - a.count);
    const top3 = allCoworkers.slice(0, 3);
    if (top3.length > 0) {
      const panelId = `cwlist_${Date.now()}`;
      html += `<div class="ps-title">${esc(counterLabel)}</div>`;
      html += `<div style="padding:16px 20px 12px;display:flex;flex-direction:column;gap:14px">`;
      allCoworkers.forEach((p, i) => {
        const rank = i + 1;
        const barPct = Math.round((p.count / allCoworkers[0].count) * 100);
        const isHidden = i >= 3;
        html += `
          <div class="cw-row" data-panel="${panelId}" style="display:${isHidden ? 'none' : 'flex'};align-items:center;gap:12px;padding:2px 0">
            <div style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--border-hi);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span style="font-size:12px;font-weight:700;color:var(--text-2);line-height:1;position:relative;top:-0.5px">${rank}</span>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
                <span class="cw-name" style="font-size:15px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.label)}</span>
                <span class="cw-count" style="font-size:13px;font-weight:600;color:var(--accent);flex-shrink:0;margin-left:8px">${p.count}回</span>
              </div>
              <div style="height:3px;background:var(--bg3);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${barPct}%;background:var(--accent);border-radius:2px"></div>
              </div>
            </div>
          </div>`;
      });
      if (allCoworkers.length > 3) {
        html += `<button onclick="
          const rows = document.querySelectorAll('.cw-row[data-panel=\\'${panelId}\\']');
          rows.forEach(r => r.style.display='flex');
          this.style.display='none';
        " style="margin-top:2px;background:transparent;border:none;color:var(--text-2);font-size:14px;font-weight:500;padding:0px 0;cursor:pointer;text-align:center;width:100%;font-family:var(--sans);transition:color .15s" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-2)'">もっと見る (${allCoworkers.length - 3}件)</button>`;
      }
      html += `</div>`;
    }
    // --- Works list ---
    html += `<div class="ps-title">${esc(sl)}</div>`;
    works.forEach(w => {
      html += `<button class="pw-item" data-work-id="${esc(w.id)}" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:var(--sans)">`;
      if (w.th) html += `<img class="pw-thumb" src="${esc(w.th)}" onerror="this.style.display='none'">`;
      html += `<div class="pw-ph" style="${w.th ? 'display:none' : ''}">🎬</div>`;
      html += `<div><div class="pw-title">${esc(w.label)}</div><div class="pw-cat">${(w.cats||[]).join(', ')}</div></div></button>`;
    });
  }
  document.getElementById('pc2').innerHTML = html;
  document.getElementById('info-panel').classList.add('visible');

  // 出演・制作作品 → 作品パネルへ遷移
  document.getElementById('pc2').querySelectorAll('.pw-item[data-work-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const work = AN.find(n => n.id === btn.dataset.workId);
      if (!work) return;
      selId = work.id;
      applyHL(selId, 'click');
      showPanel(work);
    });
  });

  // work パネル内の「参加クリエイター」ボタン → クリエイターパネルへ遷移
  document.getElementById('pc2').querySelectorAll('.work-person-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const person = AN.find(n => n.id === btn.dataset.personId);
      if (!person) return;
      selId = person.id;
      applyHL(selId, 'click');
      showPanel(person);
    });
  });

  // work パネル内の「参加クリエイター削除」バツボタン
  document.getElementById('pc2').querySelectorAll('.remove-creator-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const personId   = btn.dataset.personId;
      const personName = btn.dataset.personName;

      // 1. ローカル状態を即座に更新 (Optimistic Update)
      // リンク削除
      const linkIdx = AL.findIndex(l => {
        const s = lid(l.source), t = lid(l.target);
        return (s === personId && t === d.id) || (t === personId && s === d.id);
      });
      if (linkIdx !== -1) AL.splice(linkIdx, 1);

      // クリエイターノードの works からも削除
      const personNode = AN.find(n => n.id === personId);
      if (personNode) {
        personNode.works = personNode.works.filter(wid => wid !== d.id);
      }

      // _creatorRelIds からも削除
      if (d._creatorRelIds && personNode?.notionPageId) {
        d._creatorRelIds = d._creatorRelIds.filter(id =>
          id.replace(/-/g,'') !== (personNode.notionPageId||'').replace(/-/g,'')
        );
      }

      // UIを即座に再描画（位置維持）
      showPanel(d);
      const { nodes: vNodes, links: vLinks } = filteredData();
      redraw(vNodes, vLinks);
      selId = d.id;
      applyHL(selId, 'click');

      // バックグラウンドで Notion に反映
      if (!d.notionPageId || !personNode?.notionPageId) return;
      fetch('/notion-remove-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId:        d.notionPageId,
          creatorPageId: personNode.notionPageId,
        }),
      })
      .then(r => r.json())
      .catch(err => console.error('[RemoveCreator]', err));
    });
  });

  // クリエイター追加ボタン
  const addBtn = document.getElementById('add-creator-btn');
  if (addBtn) {
    addBtn.onclick = async (e) => {
      e.stopPropagation();
      
      // 毎回最新のデータベースを読み込む
      const originalText = addBtn.textContent;
      addBtn.textContent = '...';
      addBtn.style.pointerEvents = 'none';
      addBtn.style.opacity = '0.6';
      
      try {
        const r = await fetch('/notion-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ database: 'creators' }), // クリエイターDBのみを取得するようにリクエスト
        });
        const data = await r.json();
        if (data.creators) {
          ALL_CREATORS = data.creators;
          // 既存のアーティスト情報を消さないよう、取得したクリエイターのメタ情報のみを個別に更新
          data.creators.forEach(c => {
            const name = (c.Name || '').trim();
            if (name) {
              const sns = c.SNS ? [snsFromUrl(c.SNS)].filter(Boolean) : [];
              creatorMetaMap.set(name, { role: c.Role || '', sns, avatar: c.Avatar || '' });
            }
          });
        }
      } catch (err) {
        console.error('[AddCreator Re-fetch Error]', err);
        showToast('データの再取得に失敗しました', 'err');
      } finally {
        addBtn.textContent = originalText;
        addBtn.style.pointerEvents = 'auto';
        addBtn.style.opacity = '1';
      }
      
      showAddCreatorDropdown(addBtn, d);
    };
  }

  // work パネルを開いた瞬間にIMDB情報を自動取得
  if (d.type === 'work' && _imdbPanelId) {
    fetchImdbInfo(_imdbPanelId, d.label, d);
  }

  // ─── クリエイター/アーティストパネル: 役職・SNS 編集 ───────────────────────
  if (d.type !== 'work') {
    const metaId = `cmeta_${d.id.replace(/[^a-z0-9]/gi,'_')}`;

    // ── 役職 編集（multi_select ピッカー）──
    const roleEditBtn  = document.getElementById(`${metaId}_role_editbtn`);

    // Notionのロール色 → CSS変数マッピング
    const NOTION_COLOR = {
      default: 'var(--text-dim)', gray: '#8e8e93', brown: '#a68064',
      orange: '#ff9f0a', yellow: '#ffd60a', green: '#30d158',
      blue: 'var(--accent)', purple: '#bf5af2', pink: '#ff375f', red: 'var(--accent-red)',
    };

    let _roleOptions = null;  // キャッシュ
    let _selectedRoles = new Set();

    // ── ポップオーバー共通ユーティリティ ──
    function positionPopover(popover, anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const pw = popover.offsetWidth || 240;
      const ph = popover.offsetHeight || 260;
      let top = rect.bottom + 6;
      let left = rect.right - pw;
      if (left < 8) left = 8;
      if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
      popover.style.top  = top  + 'px';
      popover.style.left = left + 'px';
    }

    const rolePopover  = document.getElementById('role-picker-popover');
    const rolePopTags  = document.getElementById('role-popover-tags');
    const rolePopSave  = document.getElementById('role-popover-save');
    const rolePopClose = document.getElementById('role-popover-close');

    function renderRolePicker(options) {
      rolePopTags.innerHTML = '';
      if (!options || !options.length) {
        rolePopTags.innerHTML = '<span class="role-picker-loading">選択肢がありません</span>';
        return;
      }
      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'role-tag-btn' + (_selectedRoles.has(opt.name) ? ' selected' : '');
        const color = NOTION_COLOR[opt.color] || NOTION_COLOR.default;
        btn.innerHTML = `<span class="role-tag-dot" style="background:${color}"></span>${esc(opt.name)}`;
        btn.addEventListener('click', () => {
          if (_selectedRoles.has(opt.name)) {
            _selectedRoles.delete(opt.name);
            btn.classList.remove('selected');
          } else {
            _selectedRoles.add(opt.name);
            btn.classList.add('selected');
          }
        });
        rolePopTags.appendChild(btn);
      });
    }

    function closeRolePopover() {
      rolePopover.classList.remove('open');
      // クリーンアップ
      rolePopSave._handler   && rolePopSave.removeEventListener('click', rolePopSave._handler);
      rolePopClose._handler  && rolePopClose.removeEventListener('click', rolePopClose._handler);
      document.removeEventListener('mousedown', rolePopover._outsideHandler);
    }

    if (roleEditBtn) {
      roleEditBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // 他のポップオーバーを閉じる
        document.getElementById('sns-picker-popover').classList.remove('open');

        _selectedRoles = new Set(
          (d.role || '').split(',').map(r => r.trim()).filter(Boolean)
        );

        // ポップオーバーを一時表示して位置計算
        rolePopover.classList.add('open');
        rolePopTags.innerHTML = '<div class="role-picker-loading">読み込み中...</div>';
        positionPopover(rolePopover, roleEditBtn);

        if (_roleOptions) {
          renderRolePicker(_roleOptions);
        } else {
          try {
            const r = await fetch('/notion-role-options');
            const data = await r.json();
            _roleOptions = data.options || [];
            renderRolePicker(_roleOptions);
          } catch (e) {
            rolePopTags.innerHTML = `<div class="role-picker-loading">取得失敗: ${esc(e.message)}</div>`;
          }
        }
        positionPopover(rolePopover, roleEditBtn);

        // 保存ハンドラ
        const saveHandler = () => {
          const newRole = [..._selectedRoles].join(', ');
          d.role = newRole;
          const chip = document.getElementById(`${metaId}_role_chip`);
          if (chip) {
            if (newRole) {
              const roleArr = newRole.split(',').map(r => r.trim()).filter(Boolean);
              chip.className = '';
              chip.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
              chip.innerHTML = roleArr.map(r => `<span class="cmeta-role-chip">${esc(r)}</span>`).join('');
            } else {
              chip.className = 'cmeta-empty';
              chip.style.cssText = '';
              chip.innerHTML = '未設定';
            }
          }
          const pnodeRoleEl = document.querySelector(`.pnode-card[data-id="${CSS.escape(d.id)}"] .pnode-role`);
          if (pnodeRoleEl) pnodeRoleEl.textContent = newRole || 'Creator';
          const meta = creatorMetaMap.get(d.label) || {};
          meta.role = newRole;
          creatorMetaMap.set(d.label, meta);
          closeRolePopover();
          if (d.notionPageId) {
            fetch('/notion-update-creator-meta', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creatorPageId: d.notionPageId, role: newRole }),
            }).then(r => r.json()).catch(err => console.error('[UpdateMeta Role]', err));
          }
        };
        rolePopSave._handler = saveHandler;
        rolePopSave.addEventListener('click', saveHandler);

        const closeHandler = () => closeRolePopover();
        rolePopClose._handler = closeHandler;
        rolePopClose.addEventListener('click', closeHandler);

        // 外側クリックで閉じる
        const outsideHandler = (ev) => {
          if (!rolePopover.contains(ev.target) && ev.target !== roleEditBtn) closeRolePopover();
        };
        rolePopover._outsideHandler = outsideHandler;
        // 少し遅らせてバインド（開くクリック自体が即閉じしないよう）
        setTimeout(() => document.addEventListener('mousedown', outsideHandler), 0);
      });
    }

    // ── SNS 編集 ──
    const snsEditBtn = document.getElementById(`${metaId}_sns_editbtn`);
    const snsPopover  = document.getElementById('sns-picker-popover');
    const snsPopList  = document.getElementById('sns-popover-list');
    const snsPopClose = document.getElementById('sns-popover-close');

    // 編集中のSNS（1件のみ）
    let editingSns = [];

    function closeSnsPopover() {
      snsPopover.classList.remove('open');
      snsPopClose._handler && snsPopClose.removeEventListener('click', snsPopClose._handler);
      document.removeEventListener('mousedown', snsPopover._outsideHandler);
    }

    function renderSnsEditList(saveCb) {
      snsPopList.innerHTML = '';
      const s = editingSns[0] || { url: '', label: 'Web', icon: '🔗' };
      const item = document.createElement('div');
      item.className = 'cmeta-sns-item';
      item.innerHTML = `<input class="cmeta-input" value="${esc(s.url)}" placeholder="https://..." style="flex:1;padding:6px 10px">`;
      item.querySelector('input').addEventListener('input', e => {
        const val = e.target.value.trim();
        editingSns[0] = snsFromUrl(val) || { url: val, label: 'Web', icon: '🔗' };
      });
      item.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') saveCb(); });
      snsPopList.appendChild(item);
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'padding-top:8px';
      saveRow.innerHTML = `<button class="cmeta-save-btn" style="flex:1;height:28px;font-size:12px;width:100%">保存</button>`;
      saveRow.querySelector('.cmeta-save-btn').addEventListener('click', saveCb);
      snsPopList.appendChild(saveRow);
    }

    function saveSns() {
      const firstSns = editingSns[0];
      const newSns = (firstSns && firstSns.url && firstSns.url.startsWith('http')) ? [firstSns] : [];
      d.sns = newSns;
      const meta = creatorMetaMap.get(d.label) || {};
      meta.sns = newSns;
      creatorMetaMap.set(d.label, meta);
      const chipsEl = document.getElementById(`${metaId}_sns_chips`);
      if (chipsEl) {
        if (newSns.length > 0) {
          chipsEl.innerHTML = newSns.map(s =>
            `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="cmeta-sns-chip">${esc(s.label)}</a>`
          ).join('');
        } else {
          chipsEl.innerHTML = `<span class="cmeta-empty">未設定</span>`;
        }
      }
      closeSnsPopover();
      if (d.notionPageId) {
        fetch('/notion-update-creator-meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorPageId: d.notionPageId, sns: newSns.map(s => s.url) }),
        }).then(r => r.json()).catch(err => console.error('[UpdateMeta SNS]', err));
      }
    }

    if (snsEditBtn) {
      snsEditBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 他のポップオーバーを閉じる
        rolePopover.classList.remove('open');

        editingSns = d.sns && d.sns.length > 0 ? [{ ...d.sns[0] }] : [{ url: '', label: 'Web', icon: '🔗' }];
        renderSnsEditList(saveSns);

        snsPopover.classList.add('open');
        positionPopover(snsPopover, snsEditBtn);

        const inp = snsPopList.querySelector('input');
        if (inp) setTimeout(() => inp.focus(), 50);

        const closeHandler = () => closeSnsPopover();
        snsPopClose._handler = closeHandler;
        snsPopClose.addEventListener('click', closeHandler);

        const outsideHandler = (ev) => {
          if (!snsPopover.contains(ev.target) && ev.target !== snsEditBtn) closeSnsPopover();
        };
        snsPopover._outsideHandler = outsideHandler;
        setTimeout(() => document.addEventListener('mousedown', outsideHandler), 0);
      });
    }
  }
}

/* ═══════════════════════════════════════════
   ADD CREATOR LOGIC
═══════════════════════════════════════════ */
function showAddCreatorDropdown(anchor, workNode) {
  const dropdown = document.getElementById('add-creator-dropdown');
  const search = dropdown.querySelector('.acd-search');
  const list = dropdown.querySelector('.acd-list');

  // 位置調整
  const rect = anchor.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 8) + 'px';
  dropdown.style.left = (Math.max(10, rect.right - 220)) + 'px';

  const currentRelIds = new Set(workNode._creatorRelIds || []);

  const render = (q = '') => {
    list.innerHTML = '';
    const filtered = ALL_CREATORS.filter(c => 
      c.Name.toLowerCase().includes(q.toLowerCase()) && !currentRelIds.has(c.notionPageId)
    ).slice(0, 50);

    if (filtered.length === 0) {
      list.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text-dim);text-align:center">見つかりませんでした</div>`;
      return;
    }

    filtered.forEach(c => {
      const item = document.createElement('div');
      item.className = 'acd-item';
      const initial = [...c.Name][0] || '?';
      item.innerHTML = `
        <div class="acd-avatar" style="background:${c.Avatar ? 'none' : 'var(--node-dir)'}">
          ${c.Avatar ? `<img src="${esc(c.Avatar)}" style="width:100%;height:100%;object-fit:cover">` : `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">${esc(initial)}</span>`}
        </div>
        <div class="acd-name">${esc(c.Name)}</div>
        <div class="acd-role">${esc(c.Role)}</div>
      `;
      item.onclick = async () => {
        dropdown.classList.remove('open');
        await addCreatorToWork(workNode, c);
      };
      list.appendChild(item);
    });
  };

  search.value = '';
  search.oninput = (e) => render(e.target.value);
  render();

  dropdown.classList.add('open');
  search.focus();

  // 外側クリックで閉じる
  const close = (e) => {
    if (!dropdown.contains(e.target) && e.target !== anchor) {
      dropdown.classList.remove('open');
      window.removeEventListener('mousedown', close);
    }
  };
  window.addEventListener('mousedown', close);
}

function addCreatorToWork(workNode, creator) {
  if (!workNode._creatorRelIds) workNode._creatorRelIds = [];
  if (workNode._creatorRelIds.includes(creator.notionPageId)) return;

  workNode._creatorRelIds.push(creator.notionPageId);

  const creatorId = `d_${creator.Name}`;
  let targetNode = AN.find(n => n.id === creatorId);

  // グラフ上にノードが存在しない場合は新規作成（そのクリエイターの初表示など）
  if (!targetNode) {
    const sns = creator.SNS ? [snsFromUrl(creator.SNS)].filter(Boolean) : [];
    targetNode = {
      id: creatorId,
      type: 'director',
      label: creator.Name,
      role: creator.Role,
      sns: sns,
      avatar: creator.Avatar,
      notionPageId: creator.notionPageId || '',
      works: [workNode.id]
    };
    AN.push(targetNode);
  } else if (!targetNode.works.includes(workNode.id)) {
    targetNode.works.push(workNode.id);
  }

  // リンクを追加
  AL.push({ source: creatorId, target: workNode.id, ltype: 'dir' });

  // UIを即座に再描画（位置維持）
  showPanel(workNode);
  const { nodes: vNodes, links: vLinks } = filteredData();
  redraw(vNodes, vLinks);
  selId = workNode.id;
  applyHL(selId, 'click');

  // 2. バックグラウンドで非同期にNotionへリクエスト（awaitしない）
  fetch('/notion-add-creator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workId: workNode.notionPageId,
      creatorPageId: creator.notionPageId
    }),
  })
  .then(r => r.json())
  .then(d => {
    if (d.error) throw new Error(d.error);
  })
  .catch(e => {
    console.error(e);
  });
}
