"""Universe source parsers: Borsa İstanbul constituent CSV, TradingView scan, KAP flight pages (no network)."""

import json
from datetime import date

import pytest

from src.adapters import bist_reference as br

CSV_TEXT = (
    "﻿BILESEN KODU;BULTEN_ADI;ENDEKS KODU;ENDEKS ADI;ENDEKS INGILIZCE ADI;TARIH(GG/AA/YYYY)\r\n"
    "CONSTITUENT CODE;CONSTITUENT NAME;INDEX CODE;INDEX NAME IN TURKISH;INDEX NAME IN ENGLISH;DATE(DD/MM/YYYY)\r\n"
    "AEFES.E;ANADOLU EFES;XU100;BIST 100;BIST 100;23/09/2026\r\n"
    "GARAN.E;GARANTI BANKASI;XU100;BIST 100;BIST 100;23/09/2026\r\n"
    "GARAN.E;GARANTI BANKASI;XBANK;BIST BANKA;BIST BANKS;23/09/2026\r\n"
    "GARAN.E;GARANTI BANKASI;XBANK;BIST BANKA;BIST BANKS;23/09/2026\r\n"  # duplicate line
    "ISATR.E;IS BANKASI (A);XBANK;BIST BANKA;BIST BANKS;23/09/2026\r\n"
    "BAD CODE!;X;XU100;BIST 100;BIST 100;23/09/2026\r\n"
    "\r\n"
)


def flight_html(text: str) -> str:
    """A Next.js page whose flight payload carries ``text`` (split in two chunks like the real site)."""
    half = len(text) // 2
    return (
        "<html><script>self.__next_f.push([1," + json.dumps(text[:half]) + "])</script>"
        "<script>self.__next_f.push([1," + json.dumps(text[half:]) + "])</script></html>"
    )


def test_parse_index_csv_strips_suffix_skips_headers_and_duplicates():
    parsed = br.parse_index_csv(CSV_TEXT)

    assert parsed.as_of == date(2026, 9, 23)
    assert parsed.members("XU100") == {"AEFES", "GARAN"}
    assert parsed.members("XBANK") == {"GARAN", "ISATR"}
    assert len(parsed.constituents) == 4  # duplicate + invalid rows dropped
    assert parsed.indices["XBANK"].name_en == "BIST BANKS"
    assert parsed.bulletin_names()["ISATR"] == "IS BANKASI (A)"
    assert parsed.index_codes_by_ticker()["GARAN"] == ("XBANK", "XU100")


def test_parse_index_csv_rejects_empty_file():
    with pytest.raises(ValueError):
        br.parse_index_csv("BILESEN KODU;BULTEN_ADI;ENDEKS KODU\r\n")


def test_parse_tradingview_universe_normalises_rows():
    columns = ("name", "description", "isin", "sector.tr", "industry.tr", "type", "subtype",
               "market_cap_basic", "float_shares_percent_current", "indexes")
    body = {
        "totalCount": 3,
        "data": [
            {"s": "BIST:THYAO", "d": ["THYAO", "TÜRK HAVA YOLLARI A.O.", "TRATHYAO91M5", "Taşımacılık", "Havayolları",
                                     "stock", "common", 4.1e11, 50.8779,
                                     [{"name": "BIST 100", "proname": "BIST:XU100"}, {"proname": "BIST:XU030"}]]},
            {"s": "BIST:ZGOLD", "d": ["ZGOLD", "ZİRAAT ALTIN BYF", "TRYZIPO00162", None, None, "fund", "etf",
                                     float("nan"), 1e100, None]},
            {"s": "NASDAQ:AAPL", "d": ["AAPL"] + [None] * 9},  # other exchanges ignored
            {"s": "BIST:SHORT", "d": ["SHORT"]},  # malformed row ignored
        ],
    }

    rows = br.parse_tradingview_universe(body, columns)

    assert set(rows) == {"THYAO", "ZGOLD"}
    assert rows["THYAO"].index_codes == ("XU030", "XU100")
    assert rows["THYAO"].free_float_pct == 50.8779
    assert rows["ZGOLD"].market_cap is None and rows["ZGOLD"].free_float_pct is None  # NaN / sentinel → None


def test_kap_directory_pages_are_decoded_from_flight_payload():
    members = flight_html(
        '14:["$","div",null,{"data":[{"code":"G","content":['
        '{"mkkMemberOid":"oid-garan","kapMemberTitle":"TÜRKİYE GARANTİ BANKASI A.Ş.","relatedMemberTitle":"X",'
        '"stockCode":"GARAN, TGB","cityName":"İSTANBUL","relatedMemberOid":"r","kapMemberType":"IGS"},'
        '{"mkkMemberOid":"oid-thy","kapMemberTitle":"TÜRK HAVA YOLLARI A.O.","relatedMemberTitle":"Y",'
        '"stockCode":"THYAO","cityName":"İSTANBUL","relatedMemberOid":"r2","kapMemberType":"IGS"}]}]}]'
    )
    sectors = flight_html(
        '{"sectorName":"BANKALAR","sectorOid":"s1","sectorNo":"008000.001000.","mkkMemberOid":"oid-garan",'
        '"stockCode":"GARAN, TGB","title":"TÜRKİYE GARANTİ BANKASI A.Ş.","kapTypes":["IGS","YK"]},'
        '{"sectorName":"ULAŞTIRMA VE DEPOLAMA","sectorOid":"s2","sectorNo":"007000.001000.",'
        '"mkkMemberOid":"oid-thy","stockCode":"THYAO","title":"TÜRK HAVA YOLLARI A.O.","kapTypes":["IGS"]}'
    )
    markets = flight_html(
        '{"data":[{"title":"PAY PİYASASI","contents":['
        '{"financialMarketOid":"f1","financialMarketNo":"1","financialMarketName":"PAY PİYASASI","marketOid":"m1",'
        '"marketNo":1,"marketName":"YILDIZ PAZAR","marketDetailContentList":['
        '{"stockCode":"GARAN, TGB","title":"G","types":"IGS","mkkMemberOid":"oid-garan","fundOid":null}]},'
        '{"financialMarketOid":"f1","financialMarketNo":"1","financialMarketName":"PAY PİYASASI","marketOid":"m2",'
        '"marketNo":18,"marketName":"YAPILANDIRILMIŞ ÜRÜNLER VE FON PAZARI","marketDetailContentList":['
        '{"stockCode":"GARAN","title":"G","types":"IGS","mkkMemberOid":"oid-garan","fundOid":null},'
        '{"stockCode":"DMLKT","title":"D","types":null,"mkkMemberOid":null,"fundOid":null}]}]}]}'
    )

    parsed_members = br.parse_kap_members(members)
    parsed_sectors = br.parse_kap_sectors(sectors)
    parsed_markets = br.parse_kap_markets(markets)

    assert parsed_members["GARAN"].member_oid == "oid-garan"
    assert parsed_members["TGB"].codes == ("GARAN", "TGB")
    assert parsed_members["THYAO"].title == "TÜRK HAVA YOLLARI A.O."
    assert parsed_sectors["THYAO"].sector == "ULAŞTIRMA VE DEPOLAMA"
    assert parsed_markets["GARAN"] == "YILDIZ PAZAR"  # equity segment wins over structured products
    assert parsed_markets["DMLKT"] == "YAPILANDIRILMIŞ ÜRÜNLER VE FON PAZARI"


def test_parse_kap_general_page_items():
    text = (
        '"itemObject":{"no":25,"itemName":"Şirketin Sektörü","itemKey":"kpy41_acc2_sektor",'
        '"value":"MALİ KURULUŞLAR / BANKALAR","disclosureIndex":null,"creationDate":null}'
        '"itemObject":{"no":18,"itemKey":"kpy41_acc3_sermaye_arac_pazar","value":"YILDIZ PAZAR / ALT PAZAR"}'
        '"itemObject":{"no":5,"itemKey":"kpy41_acc1_int_addres","value":"www.isbank.com.tr / ir@isbank.com.tr"}'
        '"itemObject":{"no":32,"itemKey":"kpy41_acc5_odenmis_sermaye","value":"25.000.000.000"}'
        '"itemObject":{"no":29,"itemKey":"kpy41_acc5_fiili_dolasimdaki_pay","value":['
        '{"isin":"ISCTR","actualSharesOutstanding":"7.358.582.922,87","actualOutstandingSharesRatio":"29,43",'
        '"creationDate":"20260922","totalShares":"24.999.970.000,00"},'
        '{"isin":"ISATR","actualOutstandingSharesRatio":"23,55","creationDate":"20260922"}],"creationDate":"22/09/2026"}'
        '"itemObject":{"no":36,"itemKey":"kpy41_acc5_sermayede_dogrudan","value":['
        '{"shareholder":"T.İŞ BANKASI A.Ş.MENS.MUNZ.SOS.GÜV.VE YAR.SAN.VAKFI","shareInCapital":"9.665.356.912,67",'
        '"ratioInCapital":"38,66","votingRightRatio":"38,66"},'
        '{"shareholder":"DİĞER","shareInCapital":"7.480.979.929,75","ratioInCapital":"29,93","votingRightRatio":"29,93"},'
        '{"shareholder":"TOPLAM","shareInCapital":"25.000.000.000","ratioInCapital":"100","votingRightRatio":"100"}],'
        '"creationDate":"23/09/2026"}'
    )

    general = br.parse_kap_general(flight_html(text))

    assert general.sector == "MALİ KURULUŞLAR / BANKALAR" and general.sub_sector == "BANKALAR"
    assert general.markets == ("YILDIZ PAZAR", "ALT PAZAR")
    assert general.website == "www.isbank.com.tr"
    assert general.paid_in_capital == 25_000_000_000
    assert general.free_float["ISCTR"].ratio_pct == 29.43
    assert general.free_float["ISCTR"].as_of == date(2026, 9, 22)
    assert general.free_float["ISATR"].shares is None  # missing stays missing
    assert [h.name for h in general.shareholders] == ["T.İŞ BANKASI A.Ş.MENS.MUNZ.SOS.GÜV.VE YAR.SAN.VAKFI", "DİĞER"]
    assert general.shareholders_as_of == date(2026, 9, 23)


def test_parse_expected_disclosures_keeps_distinct_taxonomies():
    payload = [
        {"kapTitle": "GARANTİ", "ruleOid": "r1", "ruleTypeTerm": "9 Aylık", "startDate": "01.10.2026",
         "endDate": "19.11.2026", "stockCode": None, "subject": "Finansal Rapor", "taxonomyOid": "t-cons", "year": 2026},
        {"kapTitle": "GARANTİ", "ruleOid": "r1", "ruleTypeTerm": "9 Aylık", "startDate": "01.10.2026",
         "endDate": "19.11.2026", "stockCode": None, "subject": "Finansal Rapor", "taxonomyOid": "t-solo", "year": 2026},
        {"kapTitle": "GARANTİ", "ruleOid": "r1", "ruleTypeTerm": "9 Aylık", "startDate": "01.10.2026",
         "endDate": "19.11.2026", "stockCode": None, "subject": "Finansal Rapor", "taxonomyOid": "t-solo", "year": 2026},
        {"subject": ""},
    ]

    records = br.parse_expected_disclosures(payload)

    assert len(records) == 2
    assert records[0].end_date == date(2026, 11, 19) and records[0].fiscal_year == 2026
    assert records[0].natural_key() != records[1].natural_key()


@pytest.mark.parametrize(
    ("text", "expected"),
    [("678.740.030,84", 678_740_030.84), ("49,18", 49.18), ("100", 100.0), ("1.380.000.000", 1_380_000_000.0),
     ("-", None), (None, None), ("abc", None)],
)
def test_parse_tr_number(text, expected):
    assert br.parse_tr_number(text) == expected


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (("SKYMD", "SEKER YATIRIM", "ŞEKER YATIRIM MENKUL DEĞERLER A.Ş.", None), "Şeker Yatırım"),
        (("ISCTR", "IS BANKASI (C)", "TÜRKİYE İŞ BANKASI A.Ş.", None), "İş Bankası (C)"),
        (("YKBNK", "YAPI VE KREDI BANK.", "YAPI VE KREDİ BANKASI A.Ş.", None), "Yapı ve Kredi Bank."),
        (("ALVES", None, "ALVES KABLO SANAYİ VE TİCARET A.Ş.", None), "Alves Kablo Sanayi ve Ticaret"),
        (("QNBTR", None, None, "QNB Bank AS"), "QNB Bank"),
        (("PEGAS", None, None, "PEGAS"), "Pegas"),  # a trailing "AS" inside a word is not a legal form
        (("GRTHO", "GRAINTURK HOLDING", "GRAINTURK HOLDİNG A.Ş.", None), "Grainturk Holding"),  # foreign word: dotted i
        (("QUAGR", "QUA GRANITE HAYAL YAPI", "QUA GRANİTE HAYAL YAPI A.Ş.", None), "Qua Granite Hayal Yapı"),
        (("ALCAR", "ALARKO CARRIER", "ALARKO CARRIER SANAYİ VE TİCARET A.Ş.", None), "Alarko Carrier"),
        (("MLP", "MLP SAGLIK", "MLP SAĞLIK HİZMETLERİ A.Ş.", None), "MLP Sağlık"),  # vowel-less abbreviation
        (("DNISI", "DINAMIK ISI", "DİNAMİK ISI MAKİNA A.Ş.", None), "Dinamik Isı"),  # short Turkish word keeps ı
    ],
)
def test_display_name_for(args, expected):
    assert br.display_name_for(*args) == expected


def _tv(ticker, kind="stock", subtype="common", isin="TRAXXXXX0000"):
    return br.TvSecurity(ticker, f"{ticker} A.Ş.", isin, "Finans", "Bankalar", kind, subtype, 1e9, 30.0, ())


def test_classify_security():
    assert br.classify_security(_tv("GARAN", isin="TRAGARAN91N1"), "YILDIZ PAZAR") == "stock"
    assert br.classify_security(_tv("DOCO", isin="AT0000818802"), "ANA PAZAR") == "stock"  # foreign share
    assert br.classify_security(_tv("ISYAT", "fund", "closedend"), "ANA PAZAR") == "closed_end_fund"
    assert br.classify_security(_tv("ZGOLD", "fund", "etf", "TRYZIPO00162"), None) is None
    assert br.classify_security(_tv("ALTIN", isin="TRXDRP012213"), None) is None  # gold certificate
    assert br.classify_security(None, "YAPILANDIRILMIŞ ÜRÜNLER VE FON PAZARI") is None
    assert br.classify_security(None, "ALT PAZAR") == "stock"
