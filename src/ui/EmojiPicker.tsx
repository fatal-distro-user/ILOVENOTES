import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

/** [emoji, space-separated keywords] */
const EMOJIS: [string, string][] = [
  ['📄', 'page document file paper'], ['📝', 'memo note write edit'], ['📓', 'notebook journal'], ['📒', 'ledger notebook'], ['📔', 'notebook decorative'], ['📕', 'book red'],
  ['📗', 'book green'], ['📘', 'book blue'], ['📙', 'book orange'], ['📚', 'books library study'], ['📖', 'open book read'], ['🔖', 'bookmark'],
  ['📁', 'folder'], ['📂', 'folder open'], ['🗂️', 'section dividers index'], ['🗃️', 'card file box'], ['🗄️', 'cabinet archive'], ['📋', 'clipboard list'],
  ['📌', 'pin'], ['📍', 'location pin'], ['📎', 'paperclip attach'], ['🖇️', 'paperclips link'], ['✂️', 'scissors cut'], ['🗑️', 'trash bin delete'],
  ['⭐', 'star favorite'], ['🌟', 'glowing star'], ['✨', 'sparkles magic new'], ['💡', 'idea light bulb'], ['🔥', 'fire hot'], ['⚡', 'lightning fast energy'],
  ['🎯', 'target goal'], ['🏆', 'trophy win'], ['🎨', 'art palette paint'], ['🖌️', 'brush paint'], ['🖍️', 'crayon draw'], ['✏️', 'pencil write'],
  ['🖊️', 'pen write'], ['🖋️', 'fountain pen'], ['🎬', 'clapper movie animation film'], ['🎞️', 'film frames animation'], ['📽️', 'projector film'], ['🎥', 'camera movie'],
  ['📷', 'camera photo'], ['🖼️', 'picture frame image'], ['🎵', 'music note'], ['🎧', 'headphones audio'], ['🎙️', 'microphone record'], ['🔊', 'speaker sound'],
  ['💻', 'laptop computer code'], ['🖥️', 'desktop computer'], ['⌨️', 'keyboard'], ['🖱️', 'mouse'], ['📱', 'phone mobile'], ['🔧', 'wrench tool'],
  ['🔨', 'hammer build'], ['⚙️', 'gear settings'], ['🧪', 'test tube experiment science'], ['🔬', 'microscope science'], ['🧬', 'dna biology'], ['🧮', 'abacus math'],
  ['📐', 'ruler triangle math geometry'], ['📏', 'ruler measure'], ['➗', 'divide math'], ['🔢', 'numbers'], ['📊', 'chart bar stats'], ['📈', 'chart growth up'],
  ['📉', 'chart down'], ['💰', 'money bag finance'], ['💳', 'credit card'], ['🧾', 'receipt'], ['🏠', 'home house'], ['🏢', 'office building work'],
  ['🏫', 'school'], ['🎓', 'graduation study learn'], ['🧠', 'brain mind think'], ['💭', 'thought bubble'], ['💬', 'speech chat'], ['📣', 'megaphone announce'],
  ['📅', 'calendar date'], ['🗓️', 'calendar schedule plan'], ['⏰', 'alarm clock time'], ['⏳', 'hourglass wait'], ['🍅', 'tomato pomodoro focus'], ['☕', 'coffee break'],
  ['🍎', 'apple food'], ['🍕', 'pizza food'], ['🥗', 'salad health'], ['🍳', 'cooking recipe egg'], ['🌱', 'seedling plant grow'], ['🌳', 'tree nature'],
  ['🌸', 'flower blossom'], ['🌍', 'earth globe world'], ['🌙', 'moon night'], ['☀️', 'sun day'], ['🌈', 'rainbow'], ['❄️', 'snow winter'],
  ['🐱', 'cat animal'], ['🐶', 'dog animal'], ['🦊', 'fox animal'], ['🐙', 'octopus'], ['🦋', 'butterfly'], ['🐝', 'bee'],
  ['🚀', 'rocket launch ship'], ['✈️', 'airplane travel'], ['🚗', 'car travel'], ['🧭', 'compass navigate'], ['🗺️', 'map'], ['⛰️', 'mountain'],
  ['❤️', 'heart love'], ['💜', 'purple heart'], ['💙', 'blue heart'], ['💚', 'green heart'], ['🧡', 'orange heart'], ['🖤', 'black heart'],
  ['✅', 'check done complete'], ['❌', 'cross no'], ['❓', 'question'], ['❗', 'important exclamation'], ['⚠️', 'warning'], ['🔒', 'lock secure private'],
  ['🔑', 'key'], ['🔍', 'search magnify'], ['🔗', 'link chain'], ['🏷️', 'tag label'], ['🎁', 'gift'], ['🎮', 'game controller play'],
  ['🧩', 'puzzle piece'], ['♟️', 'chess strategy'], ['🎲', 'dice random'], ['👋', 'wave hello welcome'], ['👍', 'thumbs up good'], ['🙂', 'smile happy'],
  ['😎', 'cool'], ['🤔', 'thinking'], ['🥳', 'party celebrate'], ['👤', 'person user'], ['👥', 'people team'], ['🤝', 'handshake deal'],
];

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  /** When provided, shows a "Remove icon" button. */
  onRemove?: () => void;
}

export function EmojiPicker({ onPick, onRemove }: EmojiPickerProps) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? EMOJIS.filter(([e, k]) => e === s || k.includes(s)) : EMOJIS;
  }, [q]);
  return (
    <div className="w-[280px] p-2" data-testid="emoji-picker">
      <div className="mb-2 flex h-7 items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2">
        <Search size={13} className="text-fg-faint" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons (idea, book, star…)" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-faint" />
      </div>
      <div className="grid max-h-[220px] grid-cols-8 gap-0.5 overflow-y-auto">
        {list.map(([e, k]) => (
          <button key={e} title={k.split(' ')[0]} onClick={() => onPick(e)} className="flex h-8 w-8 items-center justify-center rounded text-[18px] hover:bg-bg-3">{e}</button>
        ))}
        {!list.length && <div className="col-span-8 py-4 text-center text-[12px] text-fg-faint">No matching icons</div>}
      </div>
      {onRemove && <button onClick={onRemove} className="mt-2 h-6 w-full rounded border border-line text-[12px] text-fg-muted hover:bg-bg-3">Remove icon</button>}
    </div>
  );
}
