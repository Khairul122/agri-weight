import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, set, update, onValue } from 'firebase/database';
import { db } from '../lib/firebase';

/**
 * Node Firebase yang digunakan untuk komunikasi real-time dengan alat fisik.
 *
 * Alur kerja:
 *  1. User klik "Mulai"  → frontend tulis status:'menimbang', komoditas, harga ke devices/SCALE-01
 *  2. Alat fisik baca status → mulai kirim berat ke devices/SCALE-01/current_weight
 *  3. Frontend dengarkan onValue current_weight → tampilkan angka live & hitung Rp live
 *  4. User klik "Selesai" (atau alat set status:'selesai') → simpan ke weight_records dengan detail harga
 *  5. Frontend reset devices/SCALE-01 ke idle
 */
function fmtTime(totalSec) {
  const m   = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

export function useInputTimbangan() {
  /* ── State UI ── */
  const [phase, setPhase]           = useState('idle'); // idle | menimbang | selesai
  const [namaPetani, setNamaPetani] = useState('');
  const [namaAlat, setNamaAlat]     = useState('SCALE-01');
  const [deviceList, setDeviceList] = useState(['SCALE-01', 'SCALE-02', 'SCALE-03']);
  const [liveWeight, setLiveWeight] = useState(0);
  const [hasilFinal, setHasilFinal] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [savedId, setSavedId]       = useState(null);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const [sessionStart, setSessionStart] = useState(null);
  const [error, setError]           = useState('');

  /* ── State Manajemen Harga Karet ── */
  const [pricesList, setPricesList] = useState([]);
  const [selectedPriceId, setSelectedPriceId] = useState('');
  const [selectedCommodity, setSelectedCommodity] = useState('');
  const [hargaPerKg, setHargaPerKg] = useState(0);

  /* ── Refs internal ── */
  const unsubRef  = useRef(null); // Firebase onValue unsubscribe
  const timerRef  = useRef(null); // interval timer
  const phaseRef  = useRef('idle'); // hindari stale closure di listener

  // Sinkronkan phaseRef setiap kali phase berubah
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Ambil daftar harga dari Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, 'prices'), (snap) => {
      if (snap.exists()) {
        setPricesList(Object.values(snap.val()));
      } else {
        setPricesList([]);
      }
    });
    return () => unsub();
  }, []);

  // Ambil daftar alat yang tersedia dari Firebase dan gabungkan dengan default
  useEffect(() => {
    const devicesRef = ref(db, 'devices');
    const unsub = onValue(devicesRef, (snap) => {
      if (snap.exists()) {
        const keys = Object.keys(snap.val());
        setDeviceList((prev) => {
          const combined = [...new Set([...prev, ...keys])];
          return combined;
        });
      }
    }, (err) => {
      console.error("Failed to fetch devices:", err);
    });
    return () => unsub();
  }, []);

  // Dengarkan status online alat fisik secara real-time berdasarkan namaAlat yang terpilih
  useEffect(() => {
    if (!namaAlat) {
      setDeviceOnline(false);
      return;
    }
    const onlineRef = ref(db, `devices/${namaAlat}/is_online`);
    const unsub = onValue(onlineRef, (snap) => {
      setDeviceOnline(snap.val() ?? false);
    });
    return () => unsub();
  }, [namaAlat]);

  // Update komoditas dan harga saat ID harga terpilih berubah
  useEffect(() => {
    const found = pricesList.find((p) => p.id === selectedPriceId);
    if (found) {
      setSelectedCommodity(`${found.komoditas} (${found.grade})`);
      setHargaPerKg(found.harga_per_kg);
    } else {
      setSelectedCommodity('');
      setHargaPerKg(0);
    }
  }, [selectedPriceId, pricesList]);

  /* ── Timer durasi sesi ── */
  useEffect(() => {
    if (phase === 'menimbang') {
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      if (phase === 'idle') setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  /* ── Cleanup saat unmount ── */
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  /* ── Simpan rekaman ke Firebase ── */
  const saveRecord = useCallback(async (finalKg) => {
    if (phaseRef.current === 'selesai') return; // hindari double-save
    setSaving(true);
    setError('');
    const id  = `WR-${Date.now()}`;
    const now = new Date().toISOString();
    const deviceRefPath = `devices/${namaAlat}`;
    try {
      // Simpan ke weight_records
      await set(ref(db, `weight_records/${id}`), {
        id,
        nama_alat:       namaAlat.trim(),
        hasil_timbangan: finalKg,
        nama_petani:     namaPetani.trim(),
        komoditas:       selectedCommodity,
        harga_per_kg:    hargaPerKg,
        total_harga:     finalKg * hargaPerKg,
        created_at:      now,
        updated_at:      now,
      });
      // Reset status alat fisik ke idle
      await update(ref(db, deviceRefPath), {
        status:         'idle',
        nama_petani:    '',
        nama_alat:      '',
        komoditas:      '',
        harga_per_kg:   0,
        current_weight: 0,
        session_id:     '',
      });
      setSavedId(id);
      setHasilFinal(finalKg);
    } catch (err) {
      console.error('[InputTimbangan] Gagal menyimpan:', err);
      setError('Gagal menyimpan data. Periksa koneksi Firebase.');
    } finally {
      setSaving(false);
      setPhase('selesai');
    }
  }, [namaAlat, namaPetani, selectedCommodity, hargaPerKg]);

  /* ── MULAI sesi ── */
  async function handleMulai() {
    if (!namaPetani.trim() || !namaAlat.trim() || !selectedPriceId) return;
    setError('');
    setLiveWeight(0);
    setHasilFinal(null);
    setSavedId(null);

    const sessionId = `WR-${Date.now()}`;
    const deviceRefPath = `devices/${namaAlat}`;

    // Tulis ke Firebase → alat fisik akan membaca ini
    await update(ref(db, deviceRefPath), {
      status:         'menimbang',
      nama_petani:    namaPetani.trim(),
      nama_alat:      namaAlat.trim(),
      komoditas:      selectedCommodity,
      harga_per_kg:   hargaPerKg,
      current_weight: 0,
      session_id:     sessionId,
    });

    // Dengarkan perubahan dari alat fisik secara real-time
    const deviceRef = ref(db, deviceRefPath);
    const unsub = onValue(deviceRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();

      // Update berat live
      setLiveWeight(data.current_weight ?? 0);
      setDeviceOnline(data.is_online ?? false);

      // Alat fisik bisa menandai selesai sendiri (mis. berat stabil)
      if (data.status === 'selesai' && phaseRef.current === 'menimbang') {
        unsub(); // hentikan listener sebelum save
        unsubRef.current = null;
        saveRecord(data.current_weight ?? 0);
      }
    });

    unsubRef.current = unsub;
    setSessionStart(new Date());
    setPhase('menimbang');
  }

  /* ── SELESAI manual oleh user ── */
  async function handleSelesai() {
    const finalKg = liveWeight;
    // Hentikan listener RTDB
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    await saveRecord(finalKg);
  }

  /* ── SESI BARU ── */
  function handleSesiBaru() {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    setPhase('idle');
    setNamaPetani('');
    setNamaAlat('');
    setSelectedPriceId('');
    setSelectedCommodity('');
    setHargaPerKg(0);
    setLiveWeight(0);
    setHasilFinal(null);
    setSavedId(null);
    setElapsed(0);
    setError('');
  }

  return {
    /* state */
    phase,
    namaPetani, setNamaPetani,
    namaAlat,   setNamaAlat,
    liveWeight,
    hasilFinal,
    saving,
    savedId,
    deviceOnline,
    elapsed,
    sessionStart,
    error,
    /* state harga karet */
    pricesList,
    selectedPriceId, setSelectedPriceId,
    selectedCommodity,
    hargaPerKg,
    /* actions */
    handleMulai,
    handleSelesai,
    handleSesiBaru,
    /* utils */
    fmtTime,
  };
}
