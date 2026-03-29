export interface UIElements {
  // Landing
  landing: HTMLElement;
  landingContent: HTMLElement;
  phraseInput: HTMLInputElement;
  joinError: HTMLElement;
  phraseHint: HTMLElement;

  // Room
  room: HTMLElement;
  messages: HTMLElement;
  messageInput: HTMLInputElement;
  userCount: HTMLElement;
  leaveButton: HTMLElement;
  brandButton: HTMLElement;
  userList: HTMLElement;
}

export function getElements(): UIElements {
  return {
    landing: document.getElementById('landing')!,
    landingContent: document.getElementById('landing-content')!,
    phraseInput: document.getElementById('phrase-input') as HTMLInputElement,
    joinError: document.getElementById('join-error')!,
    phraseHint: document.getElementById('phrase-hint')!,

    room: document.getElementById('room')!,
    messages: document.getElementById('messages')!,
    messageInput: document.getElementById('message-input') as HTMLInputElement,
    userCount: document.getElementById('user-count')!,
    leaveButton: document.getElementById('leave-btn')!,
    brandButton: document.getElementById('room-brand')!,
    userList: document.getElementById('user-list')!,
  };
}

export function showLanding(el: UIElements): void {
  el.landing.classList.remove('hidden');
  el.room.classList.add('hidden');
  el.landingContent.classList.remove('fading');
  el.phraseInput.value = '';
  el.phraseInput.focus();
}

export function showRoom(el: UIElements): void {
  el.landing.classList.add('hidden');
  el.room.classList.remove('hidden');
  el.messages.innerHTML = '';
  el.messageInput.value = '';
  el.messageInput.focus();
}

export function addMessage(
  el: UIElements,
  sender: string,
  text: string,
  isSystem: boolean,
  isOwn?: boolean,
): void {
  const line = document.createElement('div');
  line.className = 'message';

  if (isSystem) {
    line.classList.add('system');
    line.textContent = text;
  } else {
    if (isOwn) {
      line.classList.add('own');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'sender';
    nameSpan.textContent = sender;

    const textSpan = document.createElement('span');
    textSpan.className = 'text';
    textSpan.textContent = ' ' + text;

    line.appendChild(nameSpan);
    line.appendChild(textSpan);
  }

  el.messages.appendChild(line);
  el.messages.scrollTop = el.messages.scrollHeight;
}

export function updateUserCount(el: UIElements, count: number): void {
  el.userCount.textContent = count.toString();
}

export function showJoinError(el: UIElements, msg: string): void {
  el.joinError.textContent = msg;
  el.joinError.classList.remove('hidden');
}

export function hideJoinError(el: UIElements): void {
  el.joinError.textContent = '';
  el.joinError.classList.add('hidden');
}

export function updatePhraseHint(el: UIElements, length: number): void {
  if (length === 0) {
    el.phraseHint.classList.remove('visible');
    el.phraseHint.textContent = '';
    return;
  }

  el.phraseHint.classList.add('visible');

  if (length < 16) {
    el.phraseHint.textContent = 'short phrase';
    el.phraseHint.style.color = '#444444';
  } else if (length < 25) {
    el.phraseHint.textContent = 'longer is stronger';
    el.phraseHint.style.color = '#555555';
  } else {
    el.phraseHint.textContent = 'strong phrase';
    el.phraseHint.style.color = '#888888';
  }
}

interface PeerEntry {
  name: string;
  fingerprint: string; // SVG string
}

export function renderUserList(
  el: UIElements,
  ownName: string,
  _ownFingerprint: string | null,
  knownPeers: ReadonlyArray<PeerEntry>,
  anonymousCount: number,
): void {
  el.userList.innerHTML = '';

  // Self first
  const self = document.createElement('div');
  self.className = 'user-entry self';

  if (_ownFingerprint) {
    const icon = document.createElement('span');
    icon.className = 'fingerprint';
    icon.innerHTML = _ownFingerprint;
    self.appendChild(icon);
  }

  const selfName = document.createElement('span');
  selfName.textContent = ownName;
  self.appendChild(selfName);
  el.userList.appendChild(self);

  // Known peers with fingerprints
  for (const peer of knownPeers) {
    const entry = document.createElement('div');
    entry.className = 'user-entry';

    const icon = document.createElement('span');
    icon.className = 'fingerprint';
    icon.innerHTML = peer.fingerprint;

    const name = document.createElement('span');
    name.textContent = peer.name;

    entry.appendChild(icon);
    entry.appendChild(name);
    el.userList.appendChild(entry);
  }

  // Anonymous peers (connected but haven't spoken)
  for (let i = 0; i < anonymousCount; i++) {
    const entry = document.createElement('div');
    entry.className = 'user-entry anonymous';
    entry.textContent = '...';
    el.userList.appendChild(entry);
  }
}
