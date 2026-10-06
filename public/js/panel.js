/* ═══════════════════════════════════════════
   INFO PANEL
═══════════════════════════════════════════ */
function showPanel(d) {
  const col = d.type === 'director' ? 'var(--node-dir)' : d.type === 'artist' ? 'var(--node-art)' : 'var(--accent2)';
  const lbl = d.type === 'director' ? 'CREATOR' : d.type === 'artist' ? 'ARTIST' : 'WORK';
  document.getElementById('pt').textContent = lbl;

  const pnEl = document.getElementById('pn');
  pnEl.textContent = d.label;

  // クリエイター / アーティストのみ: ダブルクリックで名前を編集（編集モードのときだけ）
  pnEl.ondblclick = null;
  if ((d.type === 'director' || d.type === 'artist') && canEdit()) {
    pnEl.title = 'ダブルクリックで名前を編集';
    pnEl.style.cursor = 'text';
    pnEl.ondblclick = () => {
      if (pnEl.querySelector('input')) return;
      const oldName = d.label;
      const input = document.createElement('input');
      input.value = oldName;
      input.className = 'ph-name-input';
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
            headers: editHeaders(),
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
      img.onerror = () => { phAvatar.textContent = initial; };
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

  const searchBtn = document.getElementById('pc-search');
  const notionBtn = document.getElementById('pc-notion');
  if (d.type === 'work') {
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
    searchBtn.style.display = 'flex';
    searchBtn.onclick = () => {
      openFilmographyModal(d.label, d.avatar || '', { workTitles: linkedWorkTitles(d.id), personType: d.type });
    };
  }

  let html = '';
  if (d.type === 'work') {
    const vid = ytid(d.url);
    if (vid) {
      html += `<div class="player"><iframe id="yt-iframe" src="https://www.youtube.com/embed/${esc(vid)}?autoplay=0&modestbranding=1&rel=0&iv_load_policy=3" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    } else if (d.th) {
      html += `<img class="player-thumb" src="${esc(d.th)}" alt="" onerror="this.remove()">`;
    }
    if ((d.cats || []).length) {
      html += `<div class="panel-meta">${d.cats.map(c => tagHtml(c)).join('')}</div>`;
    }

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
      html += `<div class="panel-section">
        <div class="section-label">
          <span>参加クリエイター</span>
          <button class="icon-btn-xs" id="add-creator-btn" title="クリエイターを追加">${icon('plus', 14)}</button>
        </div>`;
      if (workPersons.length) {
        html += `<div class="person-list">`;
        workPersons.forEach(({ person }) => {
          const initial = esc([...person.label][0] || '?');
          const img = person.avatar ? `<img src="${esc(person.avatar)}" alt="" onerror="this.remove()">` : '';
          html += `<div class="person-card-wrap work-person-wrap" data-person-id="${esc(person.id)}" data-notion-page-id="${esc(person.notionPageId || '')}">
            <button class="person-card work-person-btn" data-person-id="${esc(person.id)}">
              <span class="avatar avatar-md">${initial}${img}</span>
              <span class="person-card-text">
                <span class="person-card-name">${esc(person.label)}</span>
                <span class="person-card-role">${esc(person.role || 'Creator')}</span>
              </span>
            </button>
            <button class="card-corner-btn danger remove-creator-btn" data-person-id="${esc(person.id)}" data-person-name="${esc(person.label)}" title="${esc(person.label)}を削除">${icon('x', 10)}</button>
          </div>`;
        });
        html += `</div>`;
      } else {
        html += `<div class="empty-note">なし</div>`;
      }
      html += `</div>`;
    }

    // IMDb 監督候補（クリエイター未登録の作品のみ。renderDirSuggestSection で描画）
    html += `<div id="dir-suggest-slot"></div>`;

    // IMDB セクション（パネルオープン時に自動取得）
    _imdbPanelId = `imdb_${Date.now()}`;
    html += imdbSectionHtml(_imdbPanelId);
  } else {
    const works = (d.works || []).map(wid => AN.find(n => n.id === wid)).filter(Boolean);
    const sl = d.type === 'director' ? `制作作品 (${works.length})` : `作品 (${works.length})`;

    // --- 役職 / SNS リンク（常に表示、編集ボタン付き）---
    const metaId = `cmeta_${d.id.replace(/[^a-z0-9]/gi,'_')}`;
    html += `<div id="${esc(metaId)}" class="cmeta-section">`;

    // 役職行（multi_select: カンマ区切り文字列 → 複数チップ表示）
    const roleChipsHtml = (() => {
      if (!d.role || !d.role.trim()) return `<span class="cmeta-empty" id="${esc(metaId)}_role_chip">未設定</span>`;
      const roleArr = d.role.split(',').map(r => r.trim()).filter(Boolean);
      const chips = roleArr.map(r => tagHtml(r, 'roles')).join('');
      return `<span class="cmeta-chips" id="${esc(metaId)}_role_chip">${chips}</span>`;
    })();
    html += `<div class="cmeta-row" id="${esc(metaId)}_role_view">
      <span class="cmeta-label">役職</span>
      ${roleChipsHtml}
      <button class="icon-btn-xs cmeta-edit-btn" id="${esc(metaId)}_role_editbtn" title="役職を編集">
        ${icon('pencil', 14)}
      </button>
    </div>`;

    // SNS行
    html += `<div id="${esc(metaId)}_sns_view">
      <div class="cmeta-row">
        <span class="cmeta-label">SNS</span>
        <div class="cmeta-chips" id="${esc(metaId)}_sns_chips">`;
    if (d.sns && d.sns.length > 0) {
      d.sns.forEach(s => {
        html += `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="cmeta-sns-chip">${esc(s.label)}</a>`;
      });
    } else {
      html += `<span class="cmeta-empty">未設定</span>`;
    }
    html += `</div>
        <button class="icon-btn-xs cmeta-edit-btn" id="${esc(metaId)}_sns_editbtn" title="SNSを編集">
          ${icon('pencil', 14)}
        </button>
      </div>
    </div>`;

    html += `</div>`; // cmeta-section end

    // --- Top co-workers ---
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
        countMap.set(peer.id, { label: peer.label, count: (countMap.get(peer.id)?.count || 0) + 1 });
      });
    });
    const allCoworkers = [...countMap.values()].sort((a, b) => b.count - a.count);
    const top3 = allCoworkers.slice(0, 3);
    if (top3.length > 0) {
      const panelId = `cwlist_${Date.now()}`;
      html += `<div class="ps-title">${esc(counterLabel)}</div>`;
      html += `<div class="cw-list">`;
      allCoworkers.forEach((p, i) => {
        const barPct = Math.round((p.count / allCoworkers[0].count) * 100);
        html += `
          <div class="cw-row" data-panel="${panelId}"${i >= 3 ? ' hidden' : ''}>
            <span class="cw-rank">${i + 1}</span>
            <div class="cw-body">
              <div class="cw-head">
                <span class="cw-name">${esc(p.label)}</span>
                <span class="cw-count">${p.count}回</span>
              </div>
              <div class="cw-bar"><div class="cw-bar-fill" style="width:${barPct}%"></div></div>
            </div>
          </div>`;
      });
      if (allCoworkers.length > 3) {
        html += `<button class="btn btn-ghost btn-block" onclick="
          document.querySelectorAll('.cw-row[data-panel=\\'${panelId}\\']').forEach(r => { r.hidden = false; });
          this.remove();
        ">もっと見る (${allCoworkers.length - 3}件)</button>`;
      }
      html += `</div>`;
    }
    // --- Works list ---
    html += `<div class="ps-title">${esc(sl)}</div>`;
    works.forEach(w => {
      html += `<button class="pw-item" data-work-id="${esc(w.id)}">`;
      const thumb = w.th ? `<img class="pw-thumb" src="${esc(w.th)}" alt="" onerror="this.remove()">` : '';
      html += `<div class="pw-ph">${icon('film', 16)}${thumb}</div>`;
      html += `<div class="pw-text"><div class="pw-title">${esc(w.label)}</div><div class="pw-cat">${esc((w.cats||[]).join(', '))}</div></div></button>`;
    });
  }
  document.getElementById('pc2').innerHTML = html;
  document.getElementById('info-panel').classList.add('visible');
  if (d.type === 'work') renderDirSuggestSection(d);

  // 制作作品・アーティストの作品 → 作品パネルへ遷移
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
        headers: editHeaders(),
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
      addBtn.disabled = true;
      
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
        addBtn.disabled = false;
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
        rolePopTags.appendChild(tagOptionButton(opt, 'roles', _selectedRoles.has(opt.name), name => {
          if (_selectedRoles.has(name)) _selectedRoles.delete(name); else _selectedRoles.add(name);
          return _selectedRoles.has(name);
        }));
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
              chip.innerHTML = roleArr.map(r => tagHtml(r, 'roles')).join('');
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
              headers: editHeaders(),
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
      item.innerHTML = `<input class="cmeta-input" value="${esc(s.url)}" placeholder="https://...">`;
      item.querySelector('input').addEventListener('input', e => {
        const val = e.target.value.trim();
        editingSns[0] = snsFromUrl(val) || { url: val, label: 'Web', icon: '🔗' };
      });
      item.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') saveCb(); });
      snsPopList.appendChild(item);
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'padding-top:8px';
      saveRow.innerHTML = `<button class="btn btn-primary btn-block">保存</button>`;
      saveRow.querySelector('button').addEventListener('click', saveCb);
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
          headers: editHeaders(),
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
  const currentRelIds = new Set(workNode._creatorRelIds || []);
  showPersonPicker(anchor, {
    people: ALL_CREATORS.filter(c => !currentRelIds.has(c.notionPageId)),
    onPick: c => addCreatorToWork(workNode, c),
  });
}

/** 人物を選ぶドロップダウン。onCreate を渡すと、入力した名前で新規作成する行を一番下に出す */
function showPersonPicker(anchor, { people, onPick, onCreate, avatarClass = '' }) {
  showPicker(anchor, {
    items: () => people,
    label: p => p.Name,
    itemHtml: p => `
      <span class="avatar avatar-xs${avatarClass}">${esc([...p.Name][0] || '?')}${p.Avatar ? `<img src="${esc(p.Avatar)}" alt="" onerror="this.remove()">` : ''}</span>
      <div class="acd-name">${esc(p.Name)}</div>
      <div class="acd-role">${esc(p.Role || '')}</div>`,
    onPick, onCreate,
    placeholder: onCreate ? '検索 / 新しい名前' : '検索...',
  });
}

/**
 * 検索つきの選択ドロップダウン（クリエイター・アーティスト・カテゴリ共通）。
 * items() は開くたび・選ぶたびに呼ぶ（選んだものを候補から外せる）。keepOpen なら選んでも閉じない。
 */
function showPicker(anchor, { items, label, itemHtml, onPick, onCreate, keepOpen = false, placeholder = '検索...' }) {
  const dropdown = document.getElementById('add-creator-dropdown');
  const search = dropdown.querySelector('.acd-search');
  const list = dropdown.querySelector('.acd-list');

  const rect = anchor.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 6) + 'px';
  dropdown.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 240)) + 'px';

  const closeDropdown = () => {
    dropdown.classList.remove('open');
    window.removeEventListener('mousedown', closeOnOutside);
  };
  const closeOnOutside = e => {
    if (!dropdown.contains(e.target) && !anchor.contains(e.target)) closeDropdown();
  };

  const render = () => {
    const query = search.value.trim();
    const all = items();
    const filtered = all.filter(it => label(it).toLowerCase().includes(query.toLowerCase())).slice(0, 50);
    list.innerHTML = '';
    filtered.forEach(it => {
      const item = document.createElement('div');
      item.className = 'acd-item';
      item.innerHTML = itemHtml(it);
      item.onclick = () => {
        onPick(it);
        if (keepOpen) { search.value = ''; render(); search.focus(); } else closeDropdown();
      };
      list.appendChild(item);
    });

    const exact = all.some(it => label(it).toLowerCase() === query.toLowerCase());
    if (onCreate && query && !exact) {
      const item = document.createElement('div');
      item.className = 'acd-item acd-create';
      item.innerHTML = `${icon('plus', 14)}<div class="acd-name">「${esc(query)}」を作成</div>`;
      item.onclick = () => { closeDropdown(); onCreate(query); };
      list.appendChild(item);
    } else if (!filtered.length) {
      list.innerHTML = `<div class="empty-note acd-empty">見つかりませんでした</div>`;
    }
  };

  search.value = '';
  search.placeholder = placeholder;
  search.oninput = render;
  search.onkeydown = e => {
    if (e.key === 'Enter') list.querySelector('.acd-item')?.click();
    if (e.key === 'Escape') closeDropdown();
  };
  render();

  dropdown.classList.add('open');
  search.focus();
  window.addEventListener('mousedown', closeOnOutside);
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
    headers: editHeaders(),
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
