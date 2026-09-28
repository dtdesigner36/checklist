import { STORAGE_KEY, MAX_NAME, newId, cleanName, sanitize, readDoc, makeDoc } from '../utils/presets'

// Phone-side settings page inside the Zepp app: presets and their locations.
// Add, rename, reorder and delete both, switch locations open / closed,
// choose the default preset the watch opens on start, and the watch settings.

// UI-only key: { id, t } of the preset waiting for a second tap on "Удалить пресет".
// It expires, so a tap left armed when the page was closed does not stay armed.
const CONFIRM_KEY = 'confirmDeletePreset'
const CONFIRM_MS = 60000

// glass-dark: iOS dark "inset grouped" look, Liquid Glass pills.
const T = {
  bg: '#000000',
  card: '#1C1C1E',
  sep: '#38383A',
  label: '#FFFFFF',
  sub: 'rgba(235,235,245,0.6)',
  ter: 'rgba(235,235,245,0.3)',
  glyph: 'rgba(235,235,245,0.45)',
  blue: '#0091FF',
  green: '#30D158', // switch on = closed, as on the watch
  red: '#FF4245',
  offTrack: 'rgba(235,235,245,0.3)',
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, Roboto, "Segoe UI", sans-serif'
}

// Translucent fill + bright top rim + faint bottom rim + dark hairline edge.
const GLASS = {
  background: 'rgba(120,120,128,0.24)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(255,255,255,0.08), 0 0 0 0.5px rgba(0,0,0,0.55)'
}

// The host Button has its own look: reset it before styling.
const BTN_RESET = {
  margin: '0',
  padding: '0',
  minWidth: '0',
  border: 'none',
  boxShadow: 'none',
  outline: 'none',
  fontFamily: T.font,
  WebkitAppearance: 'none',
  cursor: 'pointer'
}

const merge = (...parts) => Object.assign({}, ...parts)

// ✎ shown at the end of every editable name.
const PENCIL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E" +
  "%3Cpath fill='%238E8E93' d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41" +
  "l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'/%3E%3C/svg%3E\")"

// Transparent Button over the whole parent View: makes any View tappable.
const Invisible = (onClick) =>
  Button({
    label: '',
    onClick,
    style: merge(BTN_RESET, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'transparent',
      borderRadius: '0'
    })
  })

function emptyData() {
  return sanitize(null)
}

const VIBRATION_LABELS = [
  ['off', 'Выкл'],
  ['light', 'Лёгкая'],
  ['medium', 'Средняя'],
  ['strong', 'Сильная']
]

function move(list, id, delta) {
  const from = list.findIndex((x) => x.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return false
  const [it] = list.splice(from, 1)
  list.splice(to, 0, it)
  return true
}

AppSettingsPage({
  state: {
    data: emptyData(),
    props: {}
  },

  storage() {
    return this.state.props.settingsStorage
  },

  readStored() {
    return readDoc(this.storage().getItem(STORAGE_KEY))
  },

  load(props) {
    this.state.props = props
    const doc = this.readStored()
    this.state.data = doc ? doc.data : emptyData()
  },

  // Every change starts from the stored copy, not from what the page drew:
  // the watch may have written newer data in between.
  // change(data) edits data in place; returning false cancels the write.
  update(change) {
    this.disarmDelete()
    const doc = this.readStored()
    const data = doc ? doc.data : emptyData()
    if (change(data) === false) return
    const next = makeDoc(doc, data, 'phone')
    this.state.data = next.data
    this.storage().setItem(STORAGE_KEY, JSON.stringify(next))
  },

  // Id of the preset armed for deletion, or '' if none (or the tap is too old).
  armedDelete() {
    try {
      const armed = JSON.parse(this.storage().getItem(CONFIRM_KEY))
      return armed && Date.now() - armed.t < CONFIRM_MS ? String(armed.id) : ''
    } catch (e) {
      return ''
    }
  },

  disarmDelete() {
    // setItem rather than removeItem: the page redraws on setItem.
    if (this.storage().getItem(CONFIRM_KEY)) this.storage().setItem(CONFIRM_KEY, '')
  },

  // ---------- presets ----------

  addPreset(name) {
    const n = cleanName(name)
    if (!n) return
    this.update((data) => {
      data.presets.push({ id: newId(), name: n, locations: [] })
    })
  },

  renamePreset(id, name) {
    const n = cleanName(name)
    if (!n) return
    this.update((data) => {
      const p = data.presets.find((x) => x.id === id)
      if (!p) return false
      p.name = n
    })
  },

  setDefault(id) {
    this.update((data) => {
      if (!data.presets.some((x) => x.id === id)) return false
      data.defaultId = id
    })
  },

  movePreset(id, delta) {
    this.update((data) => move(data.presets, id, delta))
  },

  askDeletePreset(id) {
    this.storage().setItem(CONFIRM_KEY, JSON.stringify({ id, t: Date.now() }))
  },

  cancelDeletePreset() {
    this.disarmDelete()
  },

  deletePreset(id) {
    // The confirmation expired while the page was showing it: ask again.
    if (this.armedDelete() !== id) return this.askDeletePreset(id)
    this.update((data) => {
      data.presets = data.presets.filter((x) => x.id !== id)
    })
  },

  // ---------- locations ----------

  addLocation(presetId, name) {
    const n = cleanName(name)
    if (!n) return
    this.update((data) => {
      const p = data.presets.find((x) => x.id === presetId)
      if (!p) return false
      p.locations.push({ id: newId(), name: n, open: false })
    })
  },

  // Runs fn(preset, location) for the location with this id; false if it is gone.
  withLocation(data, id, fn) {
    for (const p of data.presets) {
      const loc = p.locations.find((l) => l.id === id)
      if (loc) return fn(p, loc)
    }
    return false
  },

  renameLocation(id, name) {
    const n = cleanName(name)
    if (!n) return
    this.update((data) =>
      this.withLocation(data, id, (p, loc) => {
        loc.name = n
      })
    )
  },

  setOpen(id, open) {
    this.update((data) =>
      this.withLocation(data, id, (p, loc) => {
        loc.open = !!open
      })
    )
  },

  moveLocation(id, delta) {
    this.update((data) => this.withLocation(data, id, (p) => move(p.locations, id, delta)))
  },

  removeLocation(id) {
    this.update((data) =>
      this.withLocation(data, id, (p) => {
        p.locations = p.locations.filter((l) => l.id !== id)
      })
    )
  },

  // ---------- watch settings ----------

  setSetting(key, value) {
    this.update((data) => {
      if (!(key in data.settings) || data.settings[key] === value) return false
      data.settings[key] = value
    })
  },

  // ---------- UI ----------

  // Capsule button. kind: 'glass' | 'tint' | 'danger' | 'plain'
  pill(label, kind, onClick) {
    const look = {
      glass: merge(GLASS, { color: T.label }),
      tint: merge(GLASS, { color: T.blue }),
      danger: { background: T.red, color: '#FFFFFF', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)' },
      plain: { background: 'transparent', color: T.red, padding: '0 4px' }
    }[kind]
    return Button({
      label,
      onClick,
      style: merge(
        BTN_RESET,
        {
          height: '30px',
          lineHeight: '30px',
          borderRadius: '15px',
          padding: '0 12px',
          marginLeft: '8px',
          fontSize: '15px',
          fontWeight: '600',
          letterSpacing: '-0.2px',
          whiteSpace: 'nowrap',
          flexShrink: '0'
        },
        look
      )
    })
  },

  // Bare glyph (reorder / remove) with a 40x44 touch box.
  glyph(ch, color, onClick) {
    return Button({
      label: ch,
      onClick,
      style: merge(BTN_RESET, {
        width: '40px',
        height: '44px',
        lineHeight: '44px',
        background: 'transparent',
        color: color || T.glyph,
        fontSize: '18px',
        fontWeight: '600',
        textAlign: 'center',
        flexShrink: '0'
      })
    })
  },

  // Keeps the columns in place where an arrow is not shown.
  glyphGap() {
    return View({ style: { width: '40px', flexShrink: '0' } })
  },

  // iOS switch: 64x28 track, 38x24 knob.
  iosSwitch(on, onToggle) {
    return View(
      {
        style: {
          position: 'relative',
          width: '64px',
          height: '28px',
          marginLeft: '10px',
          flexShrink: '0',
          borderRadius: '14px',
          background: on ? T.green : T.offTrack,
          transition: 'background-color 0.25s ease'
        }
      },
      [
        View({
          style: {
            position: 'absolute',
            top: '2px',
            left: on ? '24px' : '2px',
            width: '38px',
            height: '24px',
            borderRadius: '12px',
            background: '#FFFFFF',
            boxShadow: '0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16)',
            transition: 'left 0.3s cubic-bezier(0.3, 1.3, 0.5, 1)'
          }
        }),
        Invisible(onToggle)
      ]
    )
  },

  card(children, extra) {
    return View(
      {
        style: merge(
          { marginTop: '20px', background: T.card, borderRadius: '26px', overflow: 'hidden' },
          extra
        )
      },
      children
    )
  },

  // List row: 16px leading inset, hairline from the text edge to the card edge.
  row(children, last, extra) {
    return View({ style: { paddingLeft: '16px' } }, [
      View(
        {
          style: merge(
            {
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: '52px',
              paddingRight: '16px',
              borderBottom: last ? 'none' : `0.5px solid ${T.sep}`
            },
            extra
          )
        },
        children
      )
    ])
  },

  // Name that opens the rename dialog on tap. The ✎ is drawn inside the input
  // itself (as a background image), so every tap on the name reaches the input.
  nameInput(value, onChange, size, weight) {
    return View({ style: { flex: '1', minWidth: '0' } }, [
      TextInput({
        label: '',
        value,
        maxLength: MAX_NAME,
        labelStyle: { display: 'none' },
        subStyle: {
          fontFamily: T.font,
          fontSize: size || '17px',
          fontWeight: weight || '400',
          lineHeight: '22px',
          letterSpacing: '-0.4px',
          color: T.label,
          padding: '15px 28px 15px 0',
          margin: '0',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          backgroundImage: PENCIL,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
          backgroundSize: '15px 15px'
        },
        onChange
      })
    ])
  },

  addInput(label, placeholder, onAdd) {
    return TextInput({
      label,
      placeholder,
      maxLength: MAX_NAME,
      labelStyle: {
        fontFamily: T.font,
        fontSize: '17px',
        lineHeight: '22px',
        letterSpacing: '-0.4px',
        color: T.blue,
        padding: '15px 0 0',
        margin: '0'
      },
      subStyle: {
        fontFamily: T.font,
        fontSize: '15px',
        lineHeight: '20px',
        color: T.ter,
        padding: '0 0 14px',
        margin: '0'
      },
      onChange: onAdd
    })
  },

  locationRow(loc, index, count) {
    return this.row(
      [
        this.nameInput(loc.name, (val) => this.renameLocation(loc.id, val)),
        index > 0 ? this.glyph('↑', null, () => this.moveLocation(loc.id, -1)) : this.glyphGap(),
        index < count - 1 ? this.glyph('↓', null, () => this.moveLocation(loc.id, 1)) : this.glyphGap(),
        this.glyph('✕', 'rgba(255,66,69,0.9)', () => this.removeLocation(loc.id)),
        // Switch on = closed, as on the watch.
        this.iosSwitch(!loc.open, () => this.setOpen(loc.id, !loc.open))
      ].filter(Boolean)
    )
  },

  presetCard(preset, index, count, isDefault, confirming) {
    const badge = View(
      {
        style: {
          height: '30px',
          lineHeight: '30px',
          padding: '0 12px',
          borderRadius: '15px',
          background: 'rgba(0,145,255,0.18)',
          fontSize: '15px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
          flexShrink: '0'
        }
      },
      [Text({ style: { color: T.blue, fontFamily: T.font } }, '✓ По умолчанию')]
    )
    const header = this.row(
      [
        this.nameInput(preset.name, (val) => this.renamePreset(preset.id, val), '20px', '600'),
        isDefault ? badge : this.pill('Сделать основным', 'tint', () => this.setDefault(preset.id))
      ],
      false,
      { minHeight: '60px' }
    )
    const actions = this.row(
      [
        index > 0 ? this.glyph('↑', null, () => this.movePreset(preset.id, -1)) : this.glyphGap(),
        index < count - 1 ? this.glyph('↓', null, () => this.movePreset(preset.id, 1)) : this.glyphGap(),
        View({ style: { flex: '1' } }),
        ...(confirming
          ? [
              this.pill('Отмена', 'glass', () => this.cancelDeletePreset()),
              this.pill('Точно удалить?', 'danger', () => this.deletePreset(preset.id))
            ]
          : [this.pill('Удалить пресет', 'plain', () => this.askDeletePreset(preset.id))])
      ].filter(Boolean),
      true,
      { marginLeft: '-9px' }
    )
    return this.card([
      header,
      ...preset.locations.map((loc, i) => this.locationRow(loc, i, preset.locations.length)),
      this.row([
        this.addInput('＋ Добавить локацию', 'Например: входная дверь', (val) =>
          this.addLocation(preset.id, val)
        )
      ]),
      actions
    ])
  },

  settingsCard(settings) {
    const title = (text, sub) =>
      View({ style: { flex: '1', minWidth: '0', padding: '14px 0' } }, [
        Text({ style: { display: 'block', fontSize: '17px', lineHeight: '22px', color: T.label, fontFamily: T.font } }, text),
        sub
          ? Text({ style: { display: 'block', fontSize: '13px', lineHeight: '18px', color: T.sub, fontFamily: T.font } }, sub)
          : null
      ].filter(Boolean))
    // iOS segmented control
    const segments = View(
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          background: 'rgba(118,118,128,0.24)',
          borderRadius: '9px',
          padding: '2px',
          margin: '0 0 14px'
        }
      },
      VIBRATION_LABELS.map(([key, label]) =>
        Button({
          label,
          onClick: () => this.setSetting('vibration', key),
          style: merge(BTN_RESET, {
            flex: '1',
            height: '32px',
            lineHeight: '32px',
            borderRadius: '7px',
            fontSize: '13px',
            fontWeight: '600',
            color: T.label,
            background: settings.vibration === key ? '#636366' : 'transparent'
          })
        })
      )
    )
    return this.card([
      View({ style: { paddingLeft: '16px' } }, [
        View({ style: { paddingRight: '16px', borderBottom: `0.5px solid ${T.sep}` } }, [
          title('Вибрация', 'При переключении замка'),
          segments
        ])
      ]),
      this.row([
        title('Звук', 'Щелчок при переключении, если звуки часов включены'),
        this.iosSwitch(settings.sound, () => this.setSetting('sound', !settings.sound))
      ]),
      this.row(
        [
          title('Экран не гаснет', 'Пока открыто приложение'),
          this.iosSwitch(settings.keepScreen, () => this.setSetting('keepScreen', !settings.keepScreen))
        ],
        true
      )
    ])
  },

  build(props) {
    this.load(props)
    const { presets, defaultId } = this.state.data
    const confirmId = this.armedDelete()
    const stored = !!this.readStored()
    const intro = presets.length
      ? 'Пресет по умолчанию открывается на часах сразу. Переключатель включён — закрыто. ' +
        'Изменения сразу уходят на часы.'
      : stored
        ? 'Пока пусто. Создайте первый пресет ниже, например «Дом».'
        : 'Пока пусто. Создайте первый пресет ниже, например «Дом». ' +
          'Если пресеты уже есть на часах, откройте «Чеклист» на часах — они появятся здесь.'

    return View(
      {
        style: {
          minHeight: '100vh',
          boxSizing: 'border-box',
          padding: '8px 16px 48px',
          background: T.bg,
          color: T.label,
          fontFamily: T.font,
          WebkitFontSmoothing: 'antialiased'
        }
      },
      [
        // Black behind the host's own padding too (the page cannot read the app theme).
        View({
          style: { position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', background: T.bg, zIndex: '-1' }
        }),
        Text(
          {
            style: {
              display: 'block',
              fontFamily: T.font,
              fontSize: '34px',
              lineHeight: '41px',
              fontWeight: '700',
              letterSpacing: '0.4px',
              color: T.label,
              margin: '14px 0 6px'
            }
          },
          'Чеклист'
        ),
        Text(
          {
            paragraph: true,
            style: {
              display: 'block',
              fontFamily: T.font,
              fontSize: '15px',
              lineHeight: '20px',
              letterSpacing: '-0.2px',
              color: T.sub,
              margin: '0 0 4px'
            }
          },
          intro
        ),
        ...presets.map((p, i) =>
          this.presetCard(p, i, presets.length, p.id === defaultId, p.id === confirmId)
        ),
        this.card(
          [this.row([this.addInput('＋ Новый пресет', 'Например: Дом', (val) => this.addPreset(val))], true)],
          { marginTop: '28px' }
        ),
        Text(
          {
            style: {
              display: 'block',
              fontFamily: T.font,
              fontSize: '13px',
              lineHeight: '18px',
              letterSpacing: '0.2px',
              textTransform: 'uppercase',
              color: T.sub,
              margin: '32px 0 -12px 16px'
            }
          },
          'Настройки часов'
        ),
        this.settingsCard(this.state.data.settings)
      ]
    )
  }
})
