"use client";

import { useMemo, useState } from "react";
import type { JournalEntry, JournalPhoto } from "@/lib/tripShared";

export interface JournalDraft {
  date: string;
  text: string;
  photos: JournalPhoto[];
}

type Props = {
  tripId: string;
  journal: JournalEntry[];
  myName: string;
  isMember: boolean;
  photoUploads: boolean;
  defaultDate: string;
  onAdd: (d: JournalDraft) => Promise<string | null>;
  onUpdate: (id: string, d: Partial<JournalDraft>) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
};

function photoUrl(tripId: string, photo: JournalPhoto): string {
  return photo.kind === "upload" ? `/api/trips/${tripId}/photos/${photo.ref}` : photo.ref;
}

export function JournalSection({
  tripId,
  journal,
  myName,
  isMember,
  photoUploads,
  defaultDate,
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [date, setDate] = useState(defaultDate);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<JournalPhoto[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const byDate = useMemo(() => {
    const groups = new Map<string, JournalEntry[]>();
    for (const e of [...journal].sort(
      (a, b) => b.date.localeCompare(a.date) || a.createdAt - b.createdAt
    )) {
      const list = groups.get(e.date) ?? [];
      list.push(e);
      groups.set(e.date, list);
    }
    return [...groups.entries()];
  }, [journal]);

  const uploadPhoto = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("memberName", myName);
      form.append("photo", file);
      const res = await fetch(`/api/trips/${tripId}/photos`, { method: "POST", body: form });
      const json: unknown = await res.json();
      if (!res.ok) {
        const message = (json as { error?: unknown }).error;
        setError(typeof message === "string" ? message : "Couldn't upload the photo.");
        return;
      }
      const ref = (json as { ref: string }).ref;
      setPhotos((prev) => [...prev, { kind: "upload", ref }]);
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  const addLink = () => {
    const url = link.trim();
    if (!/^https:\/\/\S+$/.test(url)) return setError("Photo links must start with https://");
    setPhotos((prev) => [...prev, { kind: "link", ref: url }]);
    setLink("");
    setError(null);
  };

  const submit = async () => {
    if (!text.trim()) return setError("Write something first.");
    setBusy(true);
    setError(null);
    const err = await onAdd({ date, text: text.trim(), photos });
    setBusy(false);
    if (err) return setError(err);
    setText("");
    setPhotos([]);
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return setError("An entry can't be empty — delete it instead.");
    setBusy(true);
    const err = await onUpdate(id, { text: editText.trim() });
    setBusy(false);
    if (err) return setError(err);
    setEditingId(null);
  };

  return (
    <div className="rounded-xl border border-sky bg-paper p-5">
      <h3 className="font-display text-lg font-semibold">Trip journal</h3>

      {isMember && (
        <div className="mt-3 rounded-lg bg-mist p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-ink-soft">
              Day
              <input type="date" value={date}
                className="ml-2 rounded-lg border border-sky bg-paper px-2 py-1 text-sm text-ink"
                onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <textarea value={text} rows={3} maxLength={5000}
            placeholder="What happened today?"
            className="mt-2 block w-full rounded-lg border border-sky bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
            onChange={(e) => setText(e.target.value)} />
          {photos.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <li key={`${p.ref}-${i}`} className="relative">
                  {p.kind === "upload" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(tripId, p)} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ) : (
                    <span className="inline-block max-w-40 truncate rounded-lg bg-paper px-2 py-1 text-xs">
                      🔗 {p.ref}
                    </span>
                  )}
                  <button type="button" aria-label="Remove photo"
                    onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-seal text-[10px] text-white">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {photoUploads && (
              <label className="cursor-pointer rounded-lg border border-sky bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sky">
                📷 Add photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadPhoto(file);
                    e.target.value = "";
                  }} />
              </label>
            )}
            <input type="url" value={link} placeholder="https:// photo link"
              className="w-48 rounded-lg border border-sky bg-paper px-2 py-1.5 text-xs text-ink"
              onChange={(e) => setLink(e.target.value)} />
            <button type="button" onClick={addLink}
              className="rounded-lg border border-sky bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sky">
              Attach link
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy}
              className="ml-auto rounded-lg bg-rail px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Add entry"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-seal">{error}</p>}
        </div>
      )}

      {byDate.length === 0 && (
        <p className="mt-3 text-sm text-ink-soft">No entries yet — the diary starts with you.</p>
      )}

      <div className="mt-4 space-y-4">
        {byDate.map(([day, entries]) => (
          <div key={day}>
            <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">{day}</p>
            <ul className="mt-1.5 space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="rounded-lg border border-sky bg-mist/40 p-3 text-sm">
                  <p className="text-xs font-medium text-rail">{e.by}</p>
                  {editingId === e.id ? (
                    <div className="mt-1">
                      <textarea value={editText} rows={3} maxLength={5000}
                        className="block w-full rounded-lg border border-sky bg-paper px-3 py-2 text-sm text-ink"
                        onChange={(ev) => setEditText(ev.target.value)} />
                      <div className="mt-1.5 flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void saveEdit(e.id)}
                          className="rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}
                          className="text-xs text-ink-soft hover:text-ink">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap">{e.text}</p>
                  )}
                  {e.photos.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {e.photos.map((p, i) => (
                        <li key={`${p.ref}-${i}`}>
                          {p.kind === "upload" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photoUrl(tripId, p)} alt={`Photo by ${e.by}`}
                              className="h-24 w-24 rounded-lg object-cover" />
                          ) : (
                            <a href={p.ref} target="_blank" rel="noopener noreferrer"
                              className="inline-block max-w-48 truncate rounded-lg bg-paper px-2 py-1 text-xs text-rail hover:underline">
                              🔗 photo link
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isMember && e.by === myName && editingId !== e.id && (
                    <div className="mt-2 flex gap-3">
                      <button type="button"
                        onClick={() => {
                          setEditingId(e.id);
                          setEditText(e.text);
                        }}
                        className="text-xs text-ink-soft hover:text-ink">
                        Edit
                      </button>
                      <button type="button" onClick={() => void onDelete(e.id)}
                        className="text-xs text-ink-soft hover:text-seal">
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
