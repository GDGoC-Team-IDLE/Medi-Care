// npm run img 이 만든 파일입니다. 고치지 마세요. 원본: design/mockup/v6 (src.html · img/)
export const PNG = {
  "envelope@132-0.png": require('../../assets/img/envelope@132-0.png'),
  "envelope@132-1.png": require('../../assets/img/envelope@132-1.png'),
  "envelope@132-2.png": require('../../assets/img/envelope@132-2.png'),
  "envelope@240-0.png": require('../../assets/img/envelope@240-0.png'),
  "envelope@240-1.png": require('../../assets/img/envelope@240-1.png'),
  "envelope@240-2.png": require('../../assets/img/envelope@240-2.png'),
  "phone-ring@240-0.png": require('../../assets/img/phone-ring@240-0.png'),
  "phone-ring@240-1.png": require('../../assets/img/phone-ring@240-1.png'),
  "phone-shoot@240-0.png": require('../../assets/img/phone-shoot@240-0.png'),
  "phone-shoot@240-1.png": require('../../assets/img/phone-shoot@240-1.png'),
  "phone-shoot@240-2.png": require('../../assets/img/phone-shoot@240-2.png'),
  "photo-envelope@200.png": require('../../assets/img/photo-envelope@200.png'),
  "photo-palm-morning@200.png": require('../../assets/img/photo-palm-morning@200.png'),
  "photo-palm-noon-1@200.png": require('../../assets/img/photo-palm-noon-1@200.png'),
  "photo-palm-noon-2@200.png": require('../../assets/img/photo-palm-noon-2@200.png'),
  "pill-capsule@56.png": require('../../assets/img/pill-capsule@56.png'),
  "pill-oval@56.png": require('../../assets/img/pill-oval@56.png'),
  "pill-round-blue@56.png": require('../../assets/img/pill-round-blue@56.png'),
  "pill-scored@56.png": require('../../assets/img/pill-scored@56.png'),
  "pouch-evening@56.png": require('../../assets/img/pouch-evening@56.png'),
  "pouch-morning@56.png": require('../../assets/img/pouch-morning@56.png'),
  "pouch-noon@150-0.png": require('../../assets/img/pouch-noon@150-0.png'),
  "pouch-noon@150-1.png": require('../../assets/img/pouch-noon@150-1.png'),
  "pouch-noon@150-2.png": require('../../assets/img/pouch-noon@150-2.png'),
  "pouch-noon@150-3.png": require('../../assets/img/pouch-noon@150-3.png'),
  "pouch-noon@150-4.png": require('../../assets/img/pouch-noon@150-4.png'),
  "pouch-noon@240-0.png": require('../../assets/img/pouch-noon@240-0.png'),
  "pouch-noon@240-1.png": require('../../assets/img/pouch-noon@240-1.png'),
  "pouch-noon@240-2.png": require('../../assets/img/pouch-noon@240-2.png'),
  "pouch-noon@240-3.png": require('../../assets/img/pouch-noon@240-3.png'),
  "pouch-noon@240-4.png": require('../../assets/img/pouch-noon@240-4.png'),
  "pouch-noon@56.png": require('../../assets/img/pouch-noon@56.png'),
  "pouch-noon@64-0.png": require('../../assets/img/pouch-noon@64-0.png'),
  "pouch-noon@64-1.png": require('../../assets/img/pouch-noon@64-1.png'),
  "pouch-noon@64-2.png": require('../../assets/img/pouch-noon@64-2.png'),
  "pouch-noon@64-3.png": require('../../assets/img/pouch-noon@64-3.png'),
  "pouch-noon@64-4.png": require('../../assets/img/pouch-noon@64-4.png'),
  "pouch-open@240-0.png": require('../../assets/img/pouch-open@240-0.png'),
  "verdict-already@307-0.png": require('../../assets/img/verdict-already@307-0.png'),
  "verdict-already@307-1.png": require('../../assets/img/verdict-already@307-1.png'),
  "verdict-count@270-0.png": require('../../assets/img/verdict-count@270-0.png'),
  "verdict-ok@240-0.png": require('../../assets/img/verdict-ok@240-0.png'),
  "verdict-ok@240-1.png": require('../../assets/img/verdict-ok@240-1.png'),
  "verdict-ok@240-2.png": require('../../assets/img/verdict-ok@240-2.png'),
  "verdict-ok@240-3.png": require('../../assets/img/verdict-ok@240-3.png'),
  "verdict-ok@240-4.png": require('../../assets/img/verdict-ok@240-4.png'),
  "verdict-retake@262-0.png": require('../../assets/img/verdict-retake@262-0.png'),
  "verdict-retake@262-1.png": require('../../assets/img/verdict-retake@262-1.png'),
  "verdict-retake@262-2.png": require('../../assets/img/verdict-retake@262-2.png'),
  "verdict-wrong-time@334-0.png": require('../../assets/img/verdict-wrong-time@334-0.png'),
  "verdict-wrong-time@334-1.png": require('../../assets/img/verdict-wrong-time@334-1.png'),
  "verdict-wrong-time@334-2.png": require('../../assets/img/verdict-wrong-time@334-2.png'),
} as const;
export type PngFile = keyof typeof PNG;

/** 통짜 그림: 이름 → [파일, viewBox] */
export const SYMBOL_PNG: Record<string, [PngFile, string]> = {
  "pill-capsule": [
    "pill-capsule@56.png",
    "0 0 64 64"
  ],
  "pill-round-blue": [
    "pill-round-blue@56.png",
    "0 0 64 64"
  ],
  "pill-scored": [
    "pill-scored@56.png",
    "0 0 64 64"
  ],
  "pill-oval": [
    "pill-oval@56.png",
    "0 0 64 64"
  ],
  "pouch-morning": [
    "pouch-morning@56.png",
    "0 0 160 160"
  ],
  "pouch-noon": [
    "pouch-noon@56.png",
    "0 0 160 160"
  ],
  "pouch-evening": [
    "pouch-evening@56.png",
    "0 0 160 160"
  ],
  "photo-envelope": [
    "photo-envelope@200.png",
    "0 0 300 400"
  ],
  "photo-palm-morning": [
    "photo-palm-morning@200.png",
    "0 0 300 400"
  ],
  "photo-palm-noon-1": [
    "photo-palm-noon-1@200.png",
    "0 0 300 400"
  ],
  "photo-palm-noon-2": [
    "photo-palm-noon-2@200.png",
    "0 0 300 400"
  ]
};

export type FigNode = { cls: string; kids: FigNode[] } | { img: PngFile; x: number; y: number; w: number; h: number } | { vec: string };
/** 조각 그림: 첫 조각 파일 이름(예: verdict-ok@240) → viewBox · 조각 나무 */
export const FIGS = {
  "pouch-noon@64": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "pouch-noon@64-0.png",
            "x": 1.25,
            "y": 13.25,
            "w": 157.5,
            "h": 133.5
          },
          {
            "cls": "ak-p1",
            "kids": [
              {
                "img": "pouch-noon@64-1.png",
                "x": 31.75,
                "y": 86,
                "w": 56.75,
                "h": 44
              }
            ]
          },
          {
            "cls": "ak-p2",
            "kids": [
              {
                "img": "pouch-noon@64-2.png",
                "x": 68.25,
                "y": 84.25,
                "w": 43.5,
                "h": 43.5
              }
            ]
          },
          {
            "cls": "ak-p3",
            "kids": [
              {
                "img": "pouch-noon@64-3.png",
                "x": 91.5,
                "y": 89.5,
                "w": 41,
                "h": 41
              }
            ]
          },
          {
            "img": "pouch-noon@64-4.png",
            "x": 2.75,
            "y": 14.75,
            "w": 154.5,
            "h": 130.5
          }
        ]
      }
    ]
  },
  "envelope@132": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "envelope@132-0.png",
            "x": 22.25,
            "y": 4.25,
            "w": 115.5,
            "h": 151.5
          },
          {
            "cls": "ak-txt",
            "kids": [
              {
                "img": "envelope@132-1.png",
                "x": 18.5,
                "y": 22.5,
                "w": 123,
                "h": 137.5
              }
            ]
          },
          {
            "img": "envelope@132-2.png",
            "x": 20.5,
            "y": 2.5,
            "w": 119,
            "h": 155
          }
        ]
      }
    ]
  },
  "pouch-noon@150": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "pouch-noon@150-0.png",
            "x": 5.5,
            "y": 17.5,
            "w": 149,
            "h": 125
          },
          {
            "cls": "ak-p1",
            "kids": [
              {
                "img": "pouch-noon@150-1.png",
                "x": 38,
                "y": 92.5,
                "w": 44,
                "h": 31
              }
            ]
          },
          {
            "cls": "ak-p2",
            "kids": [
              {
                "img": "pouch-noon@150-2.png",
                "x": 74.75,
                "y": 90.75,
                "w": 30.5,
                "h": 30.5
              }
            ]
          },
          {
            "cls": "ak-p3",
            "kids": [
              {
                "img": "pouch-noon@150-3.png",
                "x": 98,
                "y": 96,
                "w": 28,
                "h": 28
              }
            ]
          },
          {
            "img": "pouch-noon@150-4.png",
            "x": 9,
            "y": 21,
            "w": 142,
            "h": 118
          }
        ]
      }
    ]
  },
  "pouch-open@240": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "pouch-open@240-0.png",
            "x": 6.75,
            "y": 29.75,
            "w": 146.5,
            "h": 111.5
          }
        ]
      }
    ]
  },
  "verdict-ok@240": {
    "vb": [
      0,
      0,
      240,
      200
    ],
    "kids": [
      {
        "cls": "vk0",
        "kids": [
          {
            "img": "verdict-ok@240-0.png",
            "x": 27,
            "y": 31,
            "w": 110,
            "h": 138
          },
          {
            "cls": "water",
            "kids": [
              {
                "img": "verdict-ok@240-1.png",
                "x": 31,
                "y": 81,
                "w": 102,
                "h": 88
              }
            ]
          },
          {
            "img": "verdict-ok@240-2.png",
            "x": 25.3333,
            "y": 29.3333,
            "w": 113.333,
            "h": 141.333
          }
        ]
      },
      {
        "cls": "vk1",
        "kids": [
          {
            "img": "verdict-ok@240-3.png",
            "x": 159.667,
            "y": 35.6667,
            "w": 52.6667,
            "h": 52.6667
          }
        ]
      },
      {
        "cls": "vk2",
        "kids": [
          {
            "img": "verdict-ok@240-4.png",
            "x": 146.333,
            "y": 104,
            "w": 75.6667,
            "h": 47.6667
          }
        ]
      }
    ]
  },
  "verdict-wrong-time@334": {
    "vb": [
      0,
      0,
      320,
      200
    ],
    "kids": [
      {
        "cls": "vk0",
        "kids": [
          {
            "img": "verdict-wrong-time@334-0.png",
            "x": 0,
            "y": 87.3333,
            "w": 99,
            "h": 85.6667
          }
        ]
      },
      {
        "cls": "vk1",
        "kids": [
          {
            "img": "verdict-wrong-time@334-1.png",
            "x": 85.6667,
            "y": 65.6667,
            "w": 148.667,
            "h": 124.667
          }
        ]
      },
      {
        "cls": "vk2",
        "kids": [
          {
            "img": "verdict-wrong-time@334-2.png",
            "x": 221.333,
            "y": 87.3333,
            "w": 98.6667,
            "h": 85.6667
          }
        ]
      },
      {
        "cls": "vk3",
        "kids": [
          {
            "vec": "<path d=\"M272 88C268 40 228 22 190 52M195.49 40.22L190 52L203 51.77\" fill=\"none\" stroke=\"#17150F\" stroke-width=\"2.1\" stroke-linejoin=\"round\" stroke-linecap=\"round\" vector-effect=\"non-scaling-stroke\" pathLength=\"1\" />"
          }
        ]
      }
    ]
  },
  "verdict-already@307": {
    "vb": [
      0,
      0,
      320,
      250
    ],
    "kids": [
      {
        "cls": "vk0",
        "kids": [
          {
            "img": "verdict-already@307-0.png",
            "x": 100,
            "y": 16.6667,
            "w": 160.333,
            "h": 58
          }
        ]
      },
      {
        "cls": "vk1",
        "kids": [
          {
            "img": "verdict-already@307-1.png",
            "x": 69,
            "y": 88,
            "w": 189.667,
            "h": 145.667
          }
        ]
      }
    ]
  },
  "verdict-count@270": {
    "vb": [
      0,
      0,
      320,
      200
    ],
    "kids": [
      {
        "cls": "vk0",
        "kids": [
          {
            "img": "verdict-count@270-0.png",
            "x": 28,
            "y": 61,
            "w": 128,
            "h": 78
          }
        ]
      },
      {
        "cls": "vk1",
        "kids": [
          {
            "vec": "<path d=\"M296 100A62 62 0 1 1 172 100A62 62 0 1 1 296 100\" fill=\"none\" stroke=\"#17150F\" stroke-width=\"2.1\" stroke-linejoin=\"round\" stroke-linecap=\"round\" vector-effect=\"non-scaling-stroke\" stroke-dasharray=\"10 9\" />"
          }
        ]
      }
    ]
  },
  "verdict-retake@262": {
    "vb": [
      0,
      0,
      240,
      220
    ],
    "kids": [
      {
        "cls": "vk0",
        "kids": [
          {
            "img": "verdict-retake@262-0.png",
            "x": 37.6667,
            "y": 35.6667,
            "w": 85,
            "h": 148.667
          }
        ]
      },
      {
        "cls": "vk1",
        "kids": [
          {
            "img": "verdict-retake@262-1.png",
            "x": 3.66667,
            "y": 65.6667,
            "w": 32.6667,
            "h": 88.6667
          }
        ]
      },
      {
        "cls": "vk2",
        "kids": [
          {
            "img": "verdict-retake@262-2.png",
            "x": 144.667,
            "y": 72.6667,
            "w": 77.3333,
            "h": 77.3333
          }
        ]
      }
    ]
  },
  "envelope@240": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "envelope@240-0.png",
            "x": 24,
            "y": 6,
            "w": 112,
            "h": 148
          },
          {
            "cls": "ak-txt",
            "kids": [
              {
                "img": "envelope@240-1.png",
                "x": 20,
                "y": 24,
                "w": 120,
                "h": 136
              }
            ]
          },
          {
            "img": "envelope@240-2.png",
            "x": 23,
            "y": 5,
            "w": 114,
            "h": 150
          }
        ]
      }
    ]
  },
  "pouch-noon@240": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "pouch-noon@240-0.png",
            "x": 6.75,
            "y": 18.75,
            "w": 146.5,
            "h": 122.5
          },
          {
            "cls": "ak-p1",
            "kids": [
              {
                "img": "pouch-noon@240-1.png",
                "x": 40,
                "y": 94.25,
                "w": 40.25,
                "h": 27.5
              }
            ]
          },
          {
            "cls": "ak-p2",
            "kids": [
              {
                "img": "pouch-noon@240-2.png",
                "x": 76.5,
                "y": 92.5,
                "w": 27,
                "h": 27
              }
            ]
          },
          {
            "cls": "ak-p3",
            "kids": [
              {
                "img": "pouch-noon@240-3.png",
                "x": 99.75,
                "y": 97.75,
                "w": 24.5,
                "h": 24.5
              }
            ]
          },
          {
            "img": "pouch-noon@240-4.png",
            "x": 11,
            "y": 23,
            "w": 138,
            "h": 114
          }
        ]
      }
    ]
  },
  "phone-shoot@240": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "phone-shoot@240-0.png",
            "x": 38.75,
            "y": 6.75,
            "w": 82.5,
            "h": 146.5
          },
          {
            "cls": "ak-cn",
            "kids": [
              {
                "img": "phone-shoot@240-1.png",
                "x": 51.25,
                "y": 35.25,
                "w": 57.5,
                "h": 91.5
              }
            ]
          },
          {
            "img": "phone-shoot@240-2.png",
            "x": 70.5,
            "y": 123.5,
            "w": 19,
            "h": 19
          }
        ]
      }
    ]
  },
  "phone-ring@240": {
    "vb": [
      0,
      0,
      160,
      160
    ],
    "kids": [
      {
        "cls": "ak-body",
        "kids": [
          {
            "img": "phone-ring@240-0.png",
            "x": 38.5,
            "y": 6.5,
            "w": 83,
            "h": 147
          }
        ]
      },
      {
        "cls": "ak-wave",
        "kids": [
          {
            "img": "phone-ring@240-1.png",
            "x": 6,
            "y": 35,
            "w": 148,
            "h": 90
          }
        ]
      }
    ]
  }
} as unknown as Record<string, { vb: [number, number, number, number]; kids: FigNode[] }>;
