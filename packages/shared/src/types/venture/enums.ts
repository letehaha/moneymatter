export enum VENTURE_VEHICLE_TYPE {
  spv = 'spv',
}

export enum VENTURE_SPV_SUBTYPE {
  single_company = 'single_company',
  multi_company = 'multi_company',
}

export enum VENTURE_DEAL_STATUS {
  outstanding = 'outstanding',
  partial_exit = 'partial_exit',
  fully_exited = 'fully_exited',
  written_off = 'written_off',
}

export enum VENTURE_EVENT_TYPE {
  initial_investment = 'initial_investment',
  capital_call = 'capital_call',
  distribution = 'distribution',
  nav_update = 'nav_update',
  exit = 'exit',
  writedown = 'writedown',
  fee_payment = 'fee_payment',
  /** Uninvested capital sent back by the vehicle. Lowers cost basis; not a distribution (no DPI, carry, or status change). */
  capital_refund = 'capital_refund',
}

export enum VENTURE_CASH_FLOW_MODE {
  linked = 'linked',
  out_of_wallet = 'out_of_wallet',
  none = 'none',
}

export enum VENTURE_WATERFALL_TYPE {
  european = 'european',
}
