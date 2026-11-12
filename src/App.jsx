import React, { useState } from 'react'
import { PlayerProvider, usePlayer } from './context/PlayerContext'
import Header from './components/Header'
import OpenPanel from './components/OpenPanel'
import Player from './components/Player'
import Overlay from './components/Overlay'
import SmbBrowser from './components/SmbBrowser'
import UpdateToast from './components/UpdateToast'

function Shell() {
  const player = usePlayer()
  const [smbOpen, setSmbOpen] = useState(false)

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <Header onOpenSmb={() => setSmbOpen(true)} />
      <div className="relative flex-1 overflow-hidden">
        {player.media ? <Player /> : <OpenPanel onOpenSmb={() => setSmbOpen(true)} />}
        <Overlay />
      </div>
      <UpdateToast />
      {smbOpen && <SmbBrowser onClose={() => setSmbOpen(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  )
}