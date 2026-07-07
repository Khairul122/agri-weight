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
  const [namaAlat, setNamaAlat]     = useState('');
  const [deviceList, setDeviceList] = useState([]);
  const [liveWeight, setLiveWeight] = useState(0);
  const [hasilFinal, setHasilFinal] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [savedId, setSavedId]       = useState(null);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [deviceData, setDeviceData]     = useState(null);
  const [elapsed, setElapsed]       = useState(0);
  const [sessionStart, setSessionStart] = useState(null);
  const [error, setError]           = useState('');

  /* ── State Manajemen Harga Karet ── */
  const [pricesList, setPricesList] = useState([]);
  const [selectedPriceId, setSelectedPriceId] = useState('');
  const [selectedCommodity, setSelectedCommodity] = useState('');
  const [hargaPerKg, setHargaPerKg] = useState(0);

  /* ── Refs internal ── */
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

  // Ambil daftar alat yang tersedia dari Firebase saja
  useEffect(() => {
    const devicesRef = ref(db, 'devices');
    const unsub = onValue(devicesRef, (snap) => {
      if (snap.exists()) {
        const keys = Object.keys(snap.val());
        setDeviceList(keys);
        
        // Atur default namaAlat ke alat pertama jika belum terpilih atau tidak ada di list
        setNamaAlat((current) => {
          if (keys.includes(current)) return current;
          return keys[0] ?? '';
        });
      } else {
        setDeviceList([]);
        setNamaAlat('');
      }
    }, (err) => {
      console.error("Failed to fetch devices:", err);
    });
    return () => unsub();
  }, []);

  // Dengarkan seluruh data dari alat terpilih secara real-time berdasarkan namaAlat yang terpilih
  useEffect(() => {
    if (!namaAlat) {
      setDeviceData(null);
      setDeviceOnline(false);
      return;
    }
    const deviceRef = ref(db, `devices/${namaAlat}`);
    const unsub = onValue(deviceRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setDeviceData(data);
        
        // Alat fisik bisa menandai selesai sendiri (mis. berat stabil)
        if (data.status === 'selesai' && phaseRef.current === 'menimbang') {
          saveRecord(data.current_weight ?? 0);
        }
      } else {
        setDeviceData(null);
        setDeviceOnline(false);
      }
    });
    return () => unsub();
  }, [namaAlat, saveRecord]);

  // Timer untuk memantau detak jantung (heartbeat) alat fisik
  useEffect(() => {
    const timer = setInterval(() => {
      if (!deviceData || !namaAlat) {
        setDeviceOnline(false);
        return;
      }

      const now = Date.now();
      const lastActive = deviceData.last_active ?? 0;
      const diffMs = now - lastActive;

      // 1. Jika data diterima dalam kurun waktu 5 detik (5000 ms), maka data terakhir yang diambil
      if (diffMs <= 5000) {
        setDeviceOnline(true);
        if (phaseRef.current === 'menimbang') {
          setLiveWeight(deviceData.current_weight ?? 0);
        }
      } else {
        // Jika tidak aktif dalam 5 detik, tandai offline
        setDeviceOnline(false);
        // liveWeight tetap pada nilai terakhir yang diterima (freeze), tidak diupdate ke 0
      }

      // 2. Jika alat fisik tidak aktif selama 5 menit (300.000 ms), ubah status alat jadi offline di Firebase
      if (diffMs >= 300000 && deviceData.is_online) {
        const deviceRefPath = `devices/${namaAlat}`;
        update(ref(db, deviceRefPath), {
          is_online: false,
          status: 'idle',
        }).catch(err => console.error("Gagal menonaktifkan alat setelah 5 menit:", err));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [deviceData, namaAlat]);

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

    setSessionStart(new Date());
    setPhase('menimbang');
  }

  /* ── SELESAI manual oleh user ── */
  async function handleSelesai() {
    const finalKg = liveWeight;
    await saveRecord(finalKg);
  }

  /* ── SESI BARU ── */
  function handleSesiBaru() {
    setPhase('idle');
    setNamaPetani('');
    setNamaAlat(deviceList[0] ?? '');
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
    deviceList,
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
