'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GROUPS, GROUP_KEYS, R32_MATCHES, R16_MATCHES, QF_MATCHES, SF_MATCHES,
  FINAL_MATCH, POINTS, MAX_SCORE, BracketPicks, defaultPicks, SlotMatch, AdvanceMatch,
  THIRD_PLACE_SLOT_ELIGIBILITY,
} from '@/lib/bracket-data';
import { cleanupInvalidPicks, matchTeams, picksCount, scoreBracket, teamFor, thirdPlaceMatchTeams } from '@/lib/scoring';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';

type Props = {
  initialPicks: BracketPicks;
  actual: BracketPicks | null;          // null = nothing entered yet -> no grading
  userId: string;
  locked: boolean;                       // if true, no edits allowed
  readOnlyName?: string;                 // when viewing someone else's bracket
};

export default function BracketEditor({ initialPicks, actual, userId, locked, readOnlyName }: Props) {
  const [picks, setPicks] = useState<BracketPicks>(initialPicks);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const readOnly = locked || !!readOnlyName;

  // Debounced save -----------------------------------------------------
  const scheduleSave = useCallback((next: BracketPicks) => {
    if (readOnly) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true); setErr(null);
      try {
        const supa = createSupabaseBrowserClient();
        const { error } = await supa
          .from('brackets')
          .upsert({
            user_id: userId,
            group_order: next.group_order,
            best_third: next.best_third,
            knockout: next.knockout,
            tiebreak_goals: next.tiebreak_goals,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        if (error) throw error;
        setSavedAt(new Date());
      } catch (e: any) {
        setErr(e?.message ?? 'Save failed');
      } finally {
        setSaving(false);
      }
    }, 600);
  }, [readOnly, userId]);

  const update = useCallback((mutator: (d: BracketPicks) => void) => {
    setPicks(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as BracketPicks;
      mutator(next);
      const cleaned = cleanupInvalidPicks(next);
      scheduleSave(cleaned);
      return cleaned;
    });
  }, [scheduleSave]);

  // Derived ------------------------------------------------------------
  const graded = !!actual && Object.keys(actual?.knockout ?? {}).length > 0;
  const { score } = useMemo(() => scoreBracket(picks, actual ?? defaultPicks()), [picks, actual]);
  const { total, max } = useMemo(() => picksCount(picks), [picks]);
  const champion = picks.knockout['F'] ?? null;

  // Group stage UI -----------------------------------------------------
  function onGroupSwap(gk: string, fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    update(d => {
      const arr = d.group_order[gk];
      [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]];
    });
  }

  function toggleThird(gk: string) {
    update(d => {
      const i = d.best_third.indexOf(gk);
      if (i >= 0) d.best_third.splice(i, 1);
      else if (d.best_third.length < 8) d.best_third.push(gk);
    });
  }

  function pickWinner(matchId: string, team: string) {
    if (readOnly) return;
    update(d => { d.knockout[matchId] = team; });
  }

  // Render helpers -----------------------------------------------------
  function SlotEl({ m, side }: { m: SlotMatch | AdvanceMatch; side: 'a' | 'b' }) {
    let slotCode: string | null;
    let team: string | null;
    if ('a' in m) {
      slotCode = side === 'a' ? m.a : m.b;
      team = teamFor(slotCode, picks);
    } else {
      slotCode = side === 'a' ? m.aFrom : m.bFrom;
      team = picks.knockout[slotCode] ?? null;
    }
    const seed = slotSeedLabel(slotCode);
    const pickedWinner = picks.knockout[m.id];
    const isPicked = !!team && pickedWinner === team;
    const classes = ['slot'];
    if (!team) classes.push('empty');
    if (isPicked) classes.push('picked');
    if (readOnly) classes.push('locked');

    if (graded && isPicked && actual) {
      const actualWinner = actual.knockout[m.id];
      if (actualWinner) {
        if (team === actualWinner) classes.push('correct');
        else classes.push('wrong');
      }
    }

    return (
      <div
        className={classes.join(' ')}
        onClick={() => { if (team && !readOnly) pickWinner(m.id, team); }}
        role="button"
        aria-disabled={!team || readOnly}
      >
        <span className="seed">{seed}</span>
        <span className="nm">{team ?? slotHint(slotCode)}</span>
      </div>
    );
  }

  function MatchCard({ m }: { m: SlotMatch | AdvanceMatch }) {
    return (
      <div className="match">
        <div className="match-tag">{m.id}</div>
        <SlotEl m={m} side="a" />
        <SlotEl m={m} side="b" />
      </div>
    );
  }

  function Round({ title, pts, matches, className }: {
    title: string; pts: string; matches: (SlotMatch | AdvanceMatch)[]; className?: string;
  }) {
    return (
      <div className={`round ${className ?? ''}`}>
        <div className="round-title">{title}<span className="pts">{pts}</span></div>
        {matches.map(m => <MatchCard key={m.id} m={m} />)}
      </div>
    );
  }

  // Third place match ---------------------------------------------------
  const tpTeams = thirdPlaceMatchTeams(picks);
  function ThirdPlaceMatchView() {
    const pickedWinner = picks.knockout['TP'];
    return (
      <div className="match">
        <div className="match-tag">3rd Place</div>
        {(['a','b'] as const).map((side, i) => {
          const team = tpTeams[i];
          const classes = ['slot'];
          if (!team) classes.push('empty');
          if (!!team && pickedWinner === team) classes.push('picked');
          if (readOnly) classes.push('locked');
          if (graded && pickedWinner === team && actual?.knockout['TP']) {
            classes.push(team === actual.knockout['TP'] ? 'correct' : 'wrong');
          }
          return (
            <div key={side} className={classes.join(' ')}
              onClick={() => team && !readOnly && pickWinner('TP', team)}>
              <span className="seed">L-S{i+1}</span>
              <span className="nm">{team ?? `Loser of semifinal ${i+1}`}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Lifecycle -----------------------------------------------------------
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  return (
    <div className="space-y-8">
      {/* Status bar */}
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="card !p-3">
          <div className="text-xs text-inkdim uppercase tracking-wider">Your score</div>
          <div className="text-2xl font-extrabold text-accent">{score}</div>
          <div className="text-[11px] text-inkdim">out of {MAX_SCORE}</div>
        </div>
        <div className="card !p-3">
          <div className="text-xs text-inkdim uppercase tracking-wider">Picks made</div>
          <div className="text-2xl font-extrabold">{total}<span className="text-inkdim text-base"> / {max}</span></div>
        </div>
        <div className="card !p-3">
          <div className="text-xs text-inkdim uppercase tracking-wider">Projected champion</div>
          <div className={`text-lg font-bold ${champion ? 'text-accent2' : 'text-inkdim italic'}`}>{champion ?? 'Not yet picked'}</div>
        </div>
        <div className="card !p-3">
          <div className="text-xs text-inkdim uppercase tracking-wider">
            {readOnlyName ? `Viewing ${readOnlyName}'s picks` : locked ? 'Bracket locked' : (saving ? 'Saving…' : savedAt ? 'Saved' : 'Auto-save on')}
          </div>
          <div className="text-sm mt-1">
            {err ? <span className="text-wrong">{err}</span>
                 : savedAt ? <span className="text-inkdim">at {savedAt.toLocaleTimeString()}</span>
                 : <span className="text-inkdim">{readOnlyName || locked ? '' : 'Changes save automatically'}</span>}
          </div>
        </div>
      </div>

      {/* GROUP STAGE */}
      <section>
        <h2 className="section-h">Group stage <span className="chip">Step 1 · 12 groups</span></h2>
        <p className="hint mb-4 max-w-3xl">
          Drag rank using the dropdowns — 1st–4th in each group. Top 2 advance automatically. Then below, pick the 8 third-place teams you think also advance.
        </p>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {GROUP_KEYS.map(gk => (
            <div key={gk} className="card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-accent font-bold">Group {gk}</h3>
                <span className="text-[11px] text-inkdim uppercase">Top 2 advance</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {(picks.group_order[gk] ?? []).map((team, idx) => (
                  <div key={idx} className="group-row" data-pos={idx+1}>
                    <div className="text-[10px] font-extrabold text-center text-inkdim">
                      {idx+1}{['st','nd','rd','th'][idx]}
                    </div>
                    <div className="font-semibold">{team}</div>
                    <select
                      value={idx + 1}
                      onChange={e => onGroupSwap(gk, idx, parseInt(e.target.value, 10) - 1)}
                      disabled={readOnly}
                    >
                      {[1,2,3,4].map(p => (
                        <option key={p} value={p}>{p}{['st','nd','rd','th'][p-1]}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Third-place pool */}
        <div className="card mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-accent font-bold">Best Third-Place Teams</h3>
            <span className={`text-xs font-bold ${picks.best_third.length===8 ? 'text-accent2' : 'text-inkdim'}`}>
              {picks.best_third.length} of 8 selected
            </span>
          </div>
          <p className="hint mt-1">Pick exactly 8 of the 12 third-placed teams that advance to the Round of 32.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            {GROUP_KEYS.map(gk => {
              const team = picks.group_order[gk]?.[2];
              const selected = picks.best_third.includes(gk);
              return (
                <div
                  key={gk}
                  role="button"
                  className={`third-chip ${selected ? 'selected' : ''}`}
                  onClick={() => !readOnly && toggleThird(gk)}
                  aria-disabled={readOnly}
                >
                  <span><span className="tag">3rd · {gk}</span> <strong className="ml-1">{team}</strong></span>
                  <span>{selected ? '✓' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* KNOCKOUT */}
      <section>
        <h2 className="section-h">Knockout bracket <span className="chip">Step 2 · Click winners</span></h2>
        <p className="hint mb-4 max-w-3xl">
          Click the team you think wins each match. Downstream rounds unlock when the previous round picks are set.
          Click a slot that says &quot;Loser of…&quot; or &quot;Winner of…&quot; once the teams are determined.
        </p>
        <div className="bracket-shell">
          <div className="bracket">
            <Round title="Round of 32" pts={`+${POINTS.R32} ea`} matches={R32_MATCHES} />
            <Round title="Round of 16" pts={`+${POINTS.R16} ea`} matches={R16_MATCHES} />
            <Round title="Quarterfinals" pts={`+${POINTS.QF} ea`} matches={QF_MATCHES} />
            <Round title="Semifinals" pts={`+${POINTS.SF} ea`} matches={SF_MATCHES} />
            <Round title="Final" pts={`+${POINTS.FINAL}`} matches={[FINAL_MATCH]} className="final" />
          </div>
        </div>

        <div className="flex flex-col items-center mt-4">
          <div className="round-title" style={{ width: 240, marginBottom: 0 }}>
            3rd Place Match <span className="pts">+{POINTS.TP}</span>
          </div>
          <div style={{ width: 240 }}>
            <ThirdPlaceMatchView />
          </div>
        </div>

        {/* Champion card */}
        <div className="mt-6 rounded-lg border-2 border-accent bg-gradient-to-br from-[#262008] to-[#1a1405] p-4 text-center">
          <div className="text-accent text-[11px] uppercase tracking-widest font-extrabold">🏆 Your pick for World Cup champion</div>
          {champion
            ? <div className="text-2xl font-extrabold mt-1">{champion}</div>
            : <div className="text-inkdim italic mt-1">Click the final match to pick your champion</div>}
        </div>
      </section>

      {/* Tiebreaker */}
      <section>
        <h2 className="section-h">Tiebreaker <span className="chip">Optional</span></h2>
        <p className="hint mb-2 max-w-2xl">How many total goals do you think your champion pick scores across the tournament? Closest guess wins ties.</p>
        <div className="flex items-center gap-3">
          <input
            type="number" min={0} max={99}
            className="input !w-28"
            value={picks.tiebreak_goals ?? ''}
            onChange={e => {
              const v = e.target.value === '' ? null : Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0));
              update(d => { d.tiebreak_goals = v; });
            }}
            disabled={readOnly}
          />
          <span className="text-sm text-inkdim">goals by {champion ?? 'your champion'}</span>
        </div>
      </section>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------
function slotHint(code: string | null): string {
  if (!code) return '—';
  if (/^M\d+$/.test(code)) return `Winner of ${code}`;
  if (/^R\d+$/.test(code)) return `Winner of ${code}`;
  if (/^Q\d+$/.test(code)) return `Winner of ${code}`;
  if (/^S\d+$/.test(code)) return `Winner of ${code}`;
  if (code[0] === 'W') return `1st · Group ${code[1]}`;
  if (code[0] === 'R' && code.length === 2) return `2nd · Group ${code[1]}`;
  if (code.startsWith('T_for_')) {
    const elig = THIRD_PLACE_SLOT_ELIGIBILITY[code] ?? [];
    return `3rd · from {${elig.join(',')}}`;
  }
  return '—';
}
function slotSeedLabel(code: string | null): string {
  if (!code) return '';
  if (code[0] === 'W') return `1${code[1]}`;
  if (code[0] === 'R' && code.length === 2) return `2${code[1]}`;
  if (code.startsWith('T_for_')) return `3rd`;
  return '';
}
