import { useInputTimbangan } from '../hooks/useInputTimbangan';

export default function InputTimbangan() {
  const {
    phase,
    namaPetani, setNamaPetani,
    namaAlat,   setNamaAlat,
    deviceList,
    liveWeight,
    hasilFinal,
    saving,
    savedId,
    deviceOnline,
    elapsed,
    sessionStart,
    error,
    handleMulai,
    handleSelesai,
    handleSesiBaru,
    fmtTime,
    /* State manajemen harga karet */
    pricesList,
    selectedPriceId, setSelectedPriceId,
    selectedCommodity,
    hargaPerKg,
  } = useInputTimbangan();

  const isIdle      = phase === 'idle';
  const isActive    = phase === 'menimbang';
  const isDone      = phase === 'selesai';
  const displayKg   = isDone ? hasilFinal : liveWeight;
  const canStart    = namaPetani.trim() !== '' && namaAlat.trim() !== '' && selectedPriceId !== '';
  const displayRp   = displayKg * hargaPerKg;

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[calc(100dvh-140px)] lg:min-h-[calc(100dvh-100px)]">

      {/* ═══════════════════════════════════════
          KIRI — Panel Timbangan (Weight Display)
          ═══════════════════════════════════════ */}
      <div className="flex-1 lg:flex-[3] flex flex-col bg-surface-container-lowest rounded-2xl shadow-card overflow-hidden">

        {/* Top bar — info alat + status */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              isActive ? 'bg-primary/10' : 'bg-surface-container-low'
            }`}>
              <span className={`material-symbols-outlined text-xl ${isActive ? 'text-primary' : 'text-text-secondary'}`}>
                scale
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-bold text-text-main text-sm truncate">
                {isIdle ? 'Timbangan Digital' : (namaAlat || 'Timbangan Digital')}
              </p>
              <p className="text-text-secondary text-xs truncate">
                {isIdle ? 'Menunggu sesi dimulai' : `${namaPetani} (${selectedCommodity})`}
              </p>
            </div>
          </div>

          {/* Badge status */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`h-2 w-2 rounded-full ${
              isActive && deviceOnline  ? 'bg-green-500 animate-pulse' :
              isActive && !deviceOnline ? 'bg-status-warning animate-pulse' :
              isDone                    ? 'bg-green-500' :
                                          'bg-text-secondary/25'
            }`} />
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
              isIdle   ? 'bg-surface-container text-text-secondary' :
              isActive ? 'bg-primary/10 text-primary' :
                         'bg-green-100 text-green-700'
            }`}>
              {isIdle ? 'SIAP' : isActive ? 'LIVE' : 'SELESAI'}
            </span>
          </div>
        </div>

        {/* Area angka berat — pusat tampilan */}
        <div className="flex-1 flex flex-col items-center justify-center relative px-6 py-8 select-none">

          {/* Ring animasi saat aktif */}
          {isActive && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 rounded-full border-2 border-primary/10" />
              <div className="absolute w-48 h-48 rounded-full border border-primary/15 animate-ping"
                   style={{ animationDuration: '3s' }} />
            </div>
          )}

          <div className="relative text-center">
            <p className="text-text-secondary text-[11px] uppercase tracking-[0.2em] font-bold mb-4">
              {isDone ? 'Hasil Akhir' : 'Pembacaan Berat'}
            </p>

            {/* Angka utama — responsif */}
            <div className={`tabular-nums font-black led-display leading-none transition-colors duration-300 ${
              isIdle ? 'text-text-secondary/20' : 'text-primary'
            } text-[60px] sm:text-[84px] lg:text-[108px] xl:text-[128px]`}>
              {(displayKg ?? 0).toFixed(2)}
            </div>

            <p className={`text-xl sm:text-2xl font-bold mt-1 ${
              isIdle ? 'text-text-secondary/20' : 'text-text-secondary'
            }`}>
              Kilogram
            </p>

            {/* Live kalkulasi harga Rupiah */}
            {!isIdle && (
              <div className="mt-4 animate-[fadeScale_0.2s_ease-out]">
                <p className="text-text-secondary text-[10px] uppercase tracking-wider font-bold mb-0.5">Nominal Transaksi</p>
                <div className="text-2xl sm:text-3xl font-black text-[#006948] tabular-nums">
                  Rp {displayRp.toLocaleString('id-ID')}
                </div>
              </div>
            )}

            {/* Timer durasi */}
            {isActive && (
              <p className="text-text-secondary/60 text-sm mt-4 font-mono tracking-widest">
                {fmtTime(elapsed)}
              </p>
            )}

            {/* Peringatan alat offline */}
            {isActive && !deviceOnline && (
              <div className="mt-5 inline-flex items-center gap-2 text-status-warning text-xs
                              bg-status-warning/10 px-4 py-2 rounded-full">
                <span className="material-symbols-outlined text-sm">wifi_off</span>
                Alat fisik belum terhubung ke Firebase
              </div>
            )}



            {/* Banner sukses setelah selesai */}
            {isDone && savedId && (
              <div className="mt-8 bg-green-50 border border-green-200 rounded-2xl px-6 py-5 text-left max-w-sm mx-auto shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-green-600">check_circle</span>
                  <span className="font-bold text-green-800">Data tersimpan!</span>
                </div>
                <div className="space-y-1.5 text-sm text-green-700">
                  <p><span className="font-semibold text-green-800/80">Petani :</span> {namaPetani}</p>
                  <p><span className="font-semibold text-green-800/80">Alat   :</span> {namaAlat}</p>
                  <p><span className="font-semibold text-green-800/80">Jenis  :</span> {selectedCommodity}</p>
                  <p><span className="font-semibold text-green-800/80">Tarif  :</span> Rp {hargaPerKg.toLocaleString('id-ID')}/Kg</p>
                  <p><span className="font-semibold text-green-800/80">Berat  :</span> {hasilFinal?.toFixed(2)} Kg</p>
                  <hr className="border-green-200 my-1.5" />
                  <p className="text-base font-bold text-green-900">
                    <span>Total  :</span> Rp {((hasilFinal ?? 0) * hargaPerKg).toLocaleString('id-ID')}
                  </p>
                  <p className="text-xs text-green-700/80"><span className="font-semibold">Durasi :</span> {fmtTime(elapsed)}</p>
                  <p className="font-mono text-green-600 text-[10px] mt-2 break-all">{savedId}</p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mt-5 inline-flex items-center gap-2 text-status-error text-xs
                              bg-status-error/10 px-4 py-2 rounded-full">
                <span className="material-symbols-outlined text-sm">error</span>
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Tombol aksi — di bawah panel kiri */}
        <div className="flex gap-3 px-6 py-5 border-t border-surface-container flex-shrink-0">
          {isIdle && (
            <button
              onClick={handleMulai}
              disabled={!canStart}
              className="flex-1 py-4 bg-primary text-on-primary font-bold rounded-xl text-sm
                         shadow-[0_8px_24px_rgba(0,105,72,0.3)] hover:bg-[#047857]
                         active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined">play_arrow</span>
              Mulai Timbang
            </button>
          )}

          {isActive && (
            <>
              <div className="flex-1 py-4 bg-surface-container text-text-secondary font-bold
                              rounded-xl text-sm flex items-center justify-center gap-2 select-none opacity-60">
                <span className="material-symbols-outlined animate-spin text-base">sync</span>
                Menimbang...
              </div>
              <button
                onClick={handleSelesai}
                disabled={saving}
                className="flex-1 py-4 bg-status-error text-white font-bold rounded-xl text-sm
                           shadow-lg active:scale-95 transition-all hover:bg-red-700
                           disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-base">sync</span>
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">stop_circle</span>
                    Selesai
                  </>
                )}
              </button>
            </>
          )}

          {isDone && (
            <button
              onClick={handleSesiBaru}
              className="flex-1 py-4 bg-primary text-on-primary font-bold rounded-xl text-sm
                         shadow-[0_8px_24px_rgba(0,105,72,0.3)] hover:bg-[#047857]
                         active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined">add_circle</span>
              Sesi Baru
            </button>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════
          KANAN — Form + Info Koneksi
          ═══════════════════════════════════ */}
      <div className="lg:flex-[2] flex flex-col gap-4">

        {/* Form input data sesi */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-card p-6 flex-1">
          <h3 className="font-bold text-text-main text-base mb-1">Data Sesi</h3>
          <p className="text-text-secondary text-xs mb-6 leading-relaxed">
            Isi data di bawah sebelum memulai. Setelah dimulai, informasi ini
            dikirim ke alat fisik melalui Firebase.
          </p>

          <div className="space-y-4">
            {/* Nama Petani */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">
                Nama Petani
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2
                                 text-text-secondary text-xl pointer-events-none">
                  person
                </span>
                <input
                  type="text"
                  value={namaPetani}
                  onChange={(e) => setNamaPetani(e.target.value)}
                  disabled={!isIdle}
                  placeholder="Masukkan nama petani..."
                  className="w-full pl-12 pr-4 py-4 bg-surface-container-low border-2 border-transparent
                             focus:border-primary focus:bg-white rounded-xl text-text-main text-sm
                             placeholder:text-text-secondary/40 focus:ring-4 focus:ring-primary/10
                             outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Nama Alat */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">
                Nama Alat
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2
                                 text-text-secondary text-xl pointer-events-none">
                  scale
                </span>
                <select
                  value={namaAlat}
                  onChange={(e) => setNamaAlat(e.target.value)}
                  disabled={!isIdle}
                  className="w-full pl-12 pr-10 py-4 bg-surface-container-low border-2 border-transparent
                             focus:border-primary focus:bg-white rounded-xl text-text-main text-sm
                             focus:ring-4 focus:ring-primary/10 outline-none transition-all
                             disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer"
                >
                  <option value="">-- Pilih Alat Timbangan --</option>
                  {deviceList.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2
                                 text-text-secondary text-xl pointer-events-none">
                  arrow_drop_down
                </span>
              </div>
            </div>

            {/* Jenis Karet & Tarif */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">
                Jenis Karet / Tarif
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2
                                 text-text-secondary text-xl pointer-events-none">
                  payments
                </span>
                <select
                  value={selectedPriceId}
                  onChange={(e) => setSelectedPriceId(e.target.value)}
                  disabled={!isIdle}
                  className="w-full pl-12 pr-10 py-4 bg-surface-container-low border-2 border-transparent
                             focus:border-primary focus:bg-white rounded-xl text-text-main text-sm
                             focus:ring-4 focus:ring-primary/10 outline-none transition-all
                             disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer"
                >
                  <option value="">-- Pilih Jenis Karet & Tarif --</option>
                  {pricesList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.komoditas} ({p.grade}) - Rp {p.harga_per_kg.toLocaleString('id-ID')}/Kg
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2
                                 text-text-secondary text-xl pointer-events-none">
                  arrow_drop_down
                </span>
              </div>
            </div>
          </div>

          {/* Info sesi aktif */}
          {!isIdle && (
            <div className="mt-6 bg-surface-container-low rounded-xl p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-3">
                Info Sesi Aktif
              </p>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                {[
                  { label: 'Petani',  value: namaPetani },
                  { label: 'Alat',    value: namaAlat },
                  { label: 'Karet',   value: selectedCommodity },
                  { label: 'Tarif',   value: `Rp ${hargaPerKg.toLocaleString('id-ID')}/Kg` },
                  { label: 'Mulai',   value: sessionStart?.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) ?? '-' },
                  { label: 'Nilai',   value: `Rp ${displayRp.toLocaleString('id-ID')}` },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</p>
                    <p className="font-bold text-text-main text-sm truncate" title={value}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status koneksi Firebase & alat fisik */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-text-secondary text-xl">sensors</span>
            <p className="font-bold text-text-main text-sm">Status Koneksi</p>
          </div>

          <div className="space-y-3">
            {[
              {
                label: 'Firebase RTDB',
                ok: true,
                desc: 'Realtime Database aktif',
              },
              {
                label: 'Alat Fisik',
                ok: deviceOnline,
                desc: deviceOnline ? 'Terhubung & siap menimbang' : 'Belum terhubung ke Firebase',
              },

              {
                label: 'Status Sesi',
                ok: isActive || isDone,
                desc: isIdle ? 'Menunggu dimulai' : isActive ? 'Sesi berjalan' : 'Sesi selesai',
              },
            ].map(({ label, ok, desc }) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-text-main text-xs font-semibold">{label}</p>
                  <p className="text-text-secondary text-[11px] truncate">{desc}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-500' : 'bg-text-secondary/30'}`} />
                  <span className={`text-xs font-bold ${ok ? 'text-green-600' : 'text-text-secondary'}`}>
                    {ok ? 'OK' : 'OFF'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Panduan alat fisik */}
          <div className="mt-4 pt-4 border-t border-surface-container">
            <p className="text-[11px] text-text-secondary leading-relaxed">
              <span className="font-semibold text-text-main">Alat fisik</span> perlu menulis ke
              <span className="font-mono bg-surface-container-low px-1 rounded text-[10px] mx-1">
                devices/SCALE-01/current_weight
              </span>
              di Firebase RTDB secara real-time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
