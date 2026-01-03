export type ModulationProfile = {
  id: string
  label: string
  f0: number
  f1: number
  bitDurationMs: number
}

export const profiles: ModulationProfile[] = [
  { id: "audible", label: "Audible BFSK", f0: 1200, f1: 2200, bitDurationMs: 80 },
  { id: "ultrasonic", label: "Ultrasonic BFSK", f0: 18000, f1: 19000, bitDurationMs: 60 }
]
