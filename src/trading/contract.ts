import { Address, Contract, contract, xdr, nativeToScVal, Operation } from '@stellar/stellar-sdk';
import { i128, u32 } from '../types/primitives.js';
import { Asset } from '../types/asset.js';
import {
    OpenPositionArgs,
    SetTriggersArgs,
    ModifyCollateralArgs,
    ExecuteRequest,
    ExecuteRequestType,
    InitializeArgs,
    TradingConfigArgs,
    MarketConfigArgs,
    QueueSetMarketArgs,
} from '../types/trading.js';
import { assetToScVal } from '../types/asset.js';

/**
 * TradingContract - Operation builder for the Zenex Trading contract
 *
 * This class extends the Stellar Contract class and provides methods
 * to build operations (XDR) for trading interactions.
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class TradingContract extends Contract {
    static spec: contract.Spec = new contract.Spec(["AAAAAQAAAC9TdHJ1Y3R1cmUgdG8gc3RvcmUgaW5mb3JtYXRpb24gYWJvdXQgYSBwb3NpdGlvbgAAAAAAAAAACFBvc2l0aW9uAAAADAAAAAAAAAALYXNzZXRfaW5kZXgAAAAABAAAAAAAAAAKY29sbGF0ZXJhbAAAAAAACwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAALZW50cnlfcHJpY2UAAAAACwAAAAAAAAACaWQAAAAAAAQAAAAAAAAADmludGVyZXN0X2luZGV4AAAAAAALAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAADW5vdGlvbmFsX3NpemUAAAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAOUG9zaXRpb25TdGF0dXMAAAAAAAAAAAAJc3RvcF9sb3NzAAAAAAAACwAAAAAAAAALdGFrZV9wcm9maXQAAAAACwAAAAAAAAAEdXNlcgAAABM=",
        "AAAAAQAAAAAAAAAAAAAACk1hcmtldERhdGEAAAAAAAcAAAAAAAAAC2xhc3RfdXBkYXRlAAAAAAYAAAAAAAAAD2xvbmdfY29sbGF0ZXJhbAAAAAALAAAAAAAAABNsb25nX2ludGVyZXN0X2luZGV4AAAAAAsAAAAAAAAAEmxvbmdfbm90aW9uYWxfc2l6ZQAAAAAACwAAAAAAAAAQc2hvcnRfY29sbGF0ZXJhbAAAAAsAAAAAAAAAFHNob3J0X2ludGVyZXN0X2luZGV4AAAACwAAAAAAAAATc2hvcnRfbm90aW9uYWxfc2l6ZQAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADENvbmZpZ1VwZGF0ZQAAAAIAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA1UcmFkaW5nQ29uZmlnAAAAAAAAAAAAAAt1bmxvY2tfdGltZQAAAAAG",
        "AAAAAQAAAAAAAAAAAAAADE1hcmtldENvbmZpZwAAAAoAAAAAAAAABWFzc2V0AAAAAAAH0AAAAAVBc3NldAAAAAAAAAAAAAAIYmFzZV9mZWUAAAALAAAAAAAAABBiYXNlX2hvdXJseV9yYXRlAAAACwAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAAAAAAtpbml0X21hcmdpbgAAAAALAAAAAAAAABJtYWludGVuYW5jZV9tYXJnaW4AAAAAAAsAAAAAAAAADm1heF9jb2xsYXRlcmFsAAAAAAALAAAAAAAAAAptYXhfcGF5b3V0AAAAAAALAAAAAAAAAA5taW5fY29sbGF0ZXJhbAAAAAAACwAAAAAAAAATcHJpY2VfaW1wYWN0X3NjYWxhcgAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADVRyYWRpbmdDb25maWcAAAAAAAAEAAAAAAAAABBjYWxsZXJfdGFrZV9yYXRlAAAACwAAAAAAAAANbWF4X3Bvc2l0aW9ucwAAAAAAAAQAAAAAAAAAD21heF91dGlsaXphdGlvbgAAAAALAAAAAAAAAAZvcmFjbGUAAAAAABM=",
        "AAAAAQAAABxSZXF1ZXN0IGZvciBrZWVwZXIgZXhlY3V0aW9uAAAAAAAAAA5FeGVjdXRlUmVxdWVzdAAAAAAAAgAAAAAAAAALcG9zaXRpb25faWQAAAAABAAAAAAAAAAMcmVxdWVzdF90eXBlAAAH0AAAABJFeGVjdXRlUmVxdWVzdFR5cGUAAA==",
        "AAAAAgAAAA9Qb3NpdGlvbiBzdGF0dXMAAAAAAAAAAA5Qb3NpdGlvblN0YXR1cwAAAAAAAwAAAAAAAAAAAAAAB1BlbmRpbmcAAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAABkNsb3NlZAAA",
        "AAAAAQAAAAAAAAAAAAAAEFF1ZXVlZE1hcmtldEluaXQAAAACAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMTWFya2V0Q29uZmlnAAAAAAAAAAt1bmxvY2tfdGltZQAAAAAG",
        "AAAAAwAAAChUeXBlcyBvZiBrZWVwZXIgYWN0aW9ucyAocGVybWlzc2lvbmxlc3MpAAAAAAAAABJFeGVjdXRlUmVxdWVzdFR5cGUAAAAAAAQAAAAAAAAABEZpbGwAAAAAAAAAAAAAAAhTdG9wTG9zcwAAAAEAAAAAAAAAClRha2VQcm9maXQAAAAAAAIAAAAAAAAACUxpcXVpZGF0ZQAAAAAAAAM=",
        "AAAABAAAAAAAAAAAAAAADFRyYWRpbmdFcnJvcgAAAB4AAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAABLAAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAS0AAAAAAAAADUludmFsaWRDb25maWcAAAAAAAEuAAAAAAAAAA9VcGRhdGVOb3RRdWV1ZWQAAAABLwAAAAAAAAARVXBkYXRlTm90VW5sb2NrZWQAAAAAAAEwAAAAAAAAAA5NYXJrZXROb3RGb3VuZAAAAAABNgAAAAAAAAATTWFya2V0SW5pdE5vdFF1ZXVlZAAAAAE3AAAAAAAAAA5NYXJrZXREaXNhYmxlZAAAAAABOAAAAAAAAAANUHJpY2VOb3RGb3VuZAAAAAAAAUAAAAAAAAAAClByaWNlU3RhbGUAAAAAAUEAAAAAAAAAEFBvc2l0aW9uTm90Rm91bmQAAAFFAAAAAAAAABVQb3NpdGlvbkFscmVhZHlDbG9zZWQAAAAAAAFGAAAAAAAAAA9Qb3NpdGlvbk5vdE9wZW4AAAABRwAAAAAAAAASUG9zaXRpb25Ob3RQZW5kaW5nAAAAAAFIAAAAAAAAABNNYXhQb3NpdGlvbnNSZWFjaGVkAAAAAUkAAAAAAAAAF05lZ2F0aXZlVmFsdWVOb3RBbGxvd2VkAAAAAUoAAAAAAAAAFkNvbGxhdGVyYWxCZWxvd01pbmltdW0AAAAAAUsAAAAAAAAAFkNvbGxhdGVyYWxBYm92ZU1heGltdW0AAAAAAUwAAAAAAAAAEUludmFsaWRFbnRyeVByaWNlAAAAAAABTgAAAAAAAAAWV2l0aGRyYXdhbEJyZWFrc01hcmdpbgAAAAABUQAAAAAAAAAWSW52YWxpZFRha2VQcm9maXRQcmljZQAAAAABVAAAAAAAAAAUSW52YWxpZFN0b3BMb3NzUHJpY2UAAAFVAAAAAAAAABZUYWtlUHJvZml0Tm90VHJpZ2dlcmVkAAAAAAFWAAAAAAAAABRTdG9wTG9zc05vdFRyaWdnZXJlZAAAAVcAAAAAAAAAF1Bvc2l0aW9uTm90TGlxdWlkYXRhYmxlAAAAAVkAAAAAAAAAFUxpbWl0T3JkZXJOb3RGaWxsYWJsZQAAAAAAAVoAAAAAAAAAGUFjdGlvbk5vdEFsbG93ZWRGb3JTdGF0dXMAAAAAAAFfAAAAAAAAAA1JbnZhbGlkU3RhdHVzAAAAAAABfQAAAAAAAAAOQ29udHJhY3RQYXVzZWQAAAAAAXwAAAAAAAAAGFV0aWxpemF0aW9uTGltaXRFeGNlZWRlZAAAAYY=",
        "AAAABQAAAAAAAAAAAAAACFN0b3BMb3NzAAAAAQAAAAlzdG9wX2xvc3MAAAAAAAAFAAAAAAAAAAthc3NldF9pbmRleAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAAAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAAAAAADZmVlAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAACVNldENvbmZpZwAAAAAAAAEAAAAKc2V0X2NvbmZpZwAAAAAAAwAAAAAAAAAGb3JhY2xlAAAAAAATAAAAAAAAAAAAAAAQY2FsbGVyX3Rha2VfcmF0ZQAAAAsAAAAAAAAAAAAAAA1tYXhfcG9zaXRpb25zAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACVNldE1hcmtldAAAAAAAAAEAAAAKc2V0X21hcmtldAAAAAAAAQAAAAAAAAALYXNzZXRfaW5kZXgAAAAABAAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAACVNldFN0YXR1cwAAAAAAAAEAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAClRha2VQcm9maXQAAAAAAAEAAAALdGFrZV9wcm9maXQAAAAABQAAAAAAAAALYXNzZXRfaW5kZXgAAAAABAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAAAAAALcG9zaXRpb25faWQAAAAABAAAAAAAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAAAAAAA2ZlZQAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0xpcXVpZGF0aW9uAAAAAAEAAAALbGlxdWlkYXRpb24AAAAABQAAAAAAAAALYXNzZXRfaW5kZXgAAAAABAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAAAAAALcG9zaXRpb25faWQAAAAABAAAAAAAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAAAAAAA2ZlZQAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC1NldFN0b3BMb3NzAAAAAAEAAAANc2V0X3N0b3BfbG9zcwAAAAAAAAQAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAAAAAAAAAAAAAVwcmljZQAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADEZpbGxQb3NpdGlvbgAAAAEAAAANZmlsbF9wb3NpdGlvbgAAAAAAAAMAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADE9wZW5Qb3NpdGlvbgAAAAEAAAANb3Blbl9wb3NpdGlvbgAAAAAAAAMAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADUNsb3NlUG9zaXRpb24AAAAAAAABAAAADmNsb3NlX3Bvc2l0aW9uAAAAAAAFAAAAAAAAAAthc3NldF9pbmRleAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAAAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAAAAAADZmVlAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADVNldFRha2VQcm9maXQAAAAAAAABAAAAD3NldF90YWtlX3Byb2ZpdAAAAAAEAAAAAAAAAAthc3NldF9pbmRleAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAAAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkNhbmNlbFBvc2l0aW9uAAAAAAABAAAAD2NhbmNlbF9wb3NpdGlvbgAAAAADAAAAAAAAAAthc3NldF9pbmRleAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlF1ZXVlU2V0Q29uZmlnAAAAAAABAAAAEHF1ZXVlX3NldF9jb25maWcAAAAEAAAAAAAAAAZvcmFjbGUAAAAAABMAAAAAAAAAAAAAABBjYWxsZXJfdGFrZV9yYXRlAAAACwAAAAAAAAAAAAAADW1heF9wb3NpdGlvbnMAAAAAAAAEAAAAAAAAAAAAAAALdW5sb2NrX3RpbWUAAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlF1ZXVlU2V0TWFya2V0AAAAAAABAAAAEHF1ZXVlX3NldF9tYXJrZXQAAAACAAAAAAAAAAVhc3NldAAAAAAAB9AAAAAFQXNzZXQAAAAAAAABAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMTWFya2V0Q29uZmlnAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD0NhbmNlbFNldENvbmZpZwAAAAABAAAAEWNhbmNlbF9zZXRfY29uZmlnAAAAAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD0NhbmNlbFNldE1hcmtldAAAAAABAAAAEWNhbmNlbF9zZXRfbWFya2V0AAAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAfQAAAABUFzc2V0AAAAAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEURlcG9zaXRDb2xsYXRlcmFsAAAAAAAAAQAAABJkZXBvc2l0X2NvbGxhdGVyYWwAAAAAAAQAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEldpdGhkcmF3Q29sbGF0ZXJhbAAAAAAAAQAAABN3aXRoZHJhd19jb2xsYXRlcmFsAAAAAAQAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAAEVRyYWRpbmdTdG9yYWdlS2V5AAAAAAAADQAAAAAAAAAAAAAABE5hbWUAAAAAAAAAAAAAAAZTdGF0dXMAAAAAAAAAAAAAAAAABVZhdWx0AAAAAAAAAAAAAAAAAAAFVG9rZW4AAAAAAAAAAAAAAAAAAAZDb25maWcAAAAAAAAAAAAAAAAADU1hcmtldENvdW50ZXIAAAAAAAAAAAAAAAAAAA9Qb3NpdGlvbkNvdW50ZXIAAAAAAAAAAAAAAAAMQ29uZmlnVXBkYXRlAAAAAQAAAAAAAAAKTWFya2V0SW5pdAAAAAAAAQAAB9AAAAAFQXNzZXQAAAAAAAABAAAAAAAAAAxNYXJrZXRDb25maWcAAAABAAAABAAAAAEAAAAAAAAACk1hcmtldERhdGEAAAAAAAEAAAAEAAAAAQAAAAAAAAANVXNlclBvc2l0aW9ucwAAAAAAAAEAAAATAAAAAQAAAAAAAAAIUG9zaXRpb24AAAABAAAABA==",
        "AAAAAQAAAAAAAAAAAAAABk1hcmtldAAAAAAAAwAAAAAAAAALYXNzZXRfaW5kZXgAAAAABAAAAAAAAAAGY29uZmlnAAAAAAfQAAAADE1hcmtldENvbmZpZwAAAAAAAAAEZGF0YQAAB9AAAAAKTWFya2V0RGF0YQAA",
        "AAAAAAAAAAAAAAAHZXhlY3V0ZQAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACHJlcXVlc3RzAAAD6gAAB9AAAAAORXhlY3V0ZVJlcXVlc3QAAAAAAAEAAAPqAAAABA==",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABXZhdWx0AAAAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAADVRyYWRpbmdDb25maWcAAAAAAAAA",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAKc2V0X21hcmtldAAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAfQAAAABUFzc2V0AAAAAAAAAA==",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAMc2V0X3RyaWdnZXJzAAAAAwAAAAAAAAALcG9zaXRpb25faWQAAAAABAAAAAAAAAALdGFrZV9wcm9maXQAAAAACwAAAAAAAAAJc3RvcF9sb3NzAAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAANb3Blbl9wb3NpdGlvbgAAAAAAAAgAAAAAAAAABHVzZXIAAAATAAAAAAAAAAthc3NldF9pbmRleAAAAAAEAAAAAAAAAApjb2xsYXRlcmFsAAAAAAALAAAAAAAAAA1ub3Rpb25hbF9zaXplAAAAAAAACwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAAtlbnRyeV9wcmljZQAAAAALAAAAAAAAAAt0YWtlX3Byb2ZpdAAAAAALAAAAAAAAAAlzdG9wX2xvc3MAAAAAAAALAAAAAQAAA+0AAAACAAAABAAAAAs=",
        "AAAAAAAAAAAAAAAOY2xvc2VfcG9zaXRpb24AAAAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAABAAAD7QAAAAIAAAALAAAACw==",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQcXVldWVfc2V0X2NvbmZpZwAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA1UcmFkaW5nQ29uZmlnAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQcXVldWVfc2V0X21hcmtldAAAAAIAAAAAAAAABWFzc2V0AAAAAAAH0AAAAAVBc3NldAAAAAAAAAAAAAAGY29uZmlnAAAAAAfQAAAADE1hcmtldENvbmZpZwAAAAA=",
        "AAAAAAAAAAAAAAARY2FuY2VsX3NldF9jb25maWcAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAARY2FuY2VsX3NldF9tYXJrZXQAAAAAAAABAAAAAAAAAAVhc3NldAAAAAAAB9AAAAAFQXNzZXQAAAAAAAAA",
        "AAAAAAAAAAAAAAARbW9kaWZ5X2NvbGxhdGVyYWwAAAAAAAACAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAAAAAA5uZXdfY29sbGF0ZXJhbAAAAAAACwAAAAA=",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAgAAAApBc3NldCB0eXBlAAAAAAAAAAAABUFzc2V0AAAAAAAAAgAAAAEAAAAAAAAAB1N0ZWxsYXIAAAAAAQAAABMAAAABAAAAAAAAAAVPdGhlcgAAAAAAAAEAAAAR",
        "AAAAAQAAAC9QcmljZSBkYXRhIGZvciBhbiBhc3NldCBhdCBhIHNwZWNpZmljIHRpbWVzdGFtcAAAAAAAAAAACVByaWNlRGF0YQAAAAAAAAIAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==",
        "AAAABAAAAAAAAAAAAAAAEVJvbGVUcmFuc2ZlckVycm9yAAAAAAAAAwAAAAAAAAARTm9QZW5kaW5nVHJhbnNmZXIAAAAAAAiYAAAAAAAAABZJbnZhbGlkTGl2ZVVudGlsTGVkZ2VyAAAAAAiZAAAAAAAAABVJbnZhbGlkUGVuZGluZ0FjY291bnQAAAAAAAia",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIGdyYW50ZWQuAAAAAAAAAAAAAAtSb2xlR3JhbnRlZAAAAAABAAAADHJvbGVfZ3JhbnRlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIHJldm9rZWQuAAAAAAAAAAAAAAtSb2xlUmV2b2tlZAAAAAABAAAADHJvbGVfcmV2b2tlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAC9FdmVudCBlbWl0dGVkIHdoZW4gdGhlIGFkbWluIHJvbGUgaXMgcmVub3VuY2VkLgAAAAAAAAAADkFkbWluUmVub3VuY2VkAAAAAAABAAAAD2FkbWluX3Jlbm91bmNlZAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAAAg==",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGFkbWluIGlzIGNoYW5nZWQuAAAAAAAAAAAQUm9sZUFkbWluQ2hhbmdlZAAAAAEAAAAScm9sZV9hZG1pbl9jaGFuZ2VkAAAAAAADAAAAAAAAAARyb2xlAAAAEQAAAAEAAAAAAAAAE3ByZXZpb3VzX2FkbWluX3JvbGUAAAAAEQAAAAAAAAAAAAAADm5ld19hZG1pbl9yb2xlAAAAAAARAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAAEkFjY2Vzc0NvbnRyb2xFcnJvcgAAAAAACwAAAAAAAAAMVW5hdXRob3JpemVkAAAH0AAAAAAAAAALQWRtaW5Ob3RTZXQAAAAH0QAAAAAAAAAQSW5kZXhPdXRPZkJvdW5kcwAAB9IAAAAAAAAAEUFkbWluUm9sZU5vdEZvdW5kAAAAAAAH0wAAAAAAAAASUm9sZUNvdW50SXNOb3RaZXJvAAAAAAfUAAAAAAAAAAxSb2xlTm90Rm91bmQAAAfVAAAAAAAAAA9BZG1pbkFscmVhZHlTZXQAAAAH1gAAAAAAAAALUm9sZU5vdEhlbGQAAAAH1wAAAAAAAAALUm9sZUlzRW1wdHkAAAAH2AAAAAAAAAASVHJhbnNmZXJJblByb2dyZXNzAAAAAAfZAAAAAAAAABBNYXhSb2xlc0V4Y2VlZGVkAAAH2g==",
        "AAAABQAAADJFdmVudCBlbWl0dGVkIHdoZW4gYW4gYWRtaW4gdHJhbnNmZXIgaXMgY29tcGxldGVkLgAAAAAAAAAAABZBZG1pblRyYW5zZmVyQ29tcGxldGVkAAAAAAABAAAAGGFkbWluX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAIAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAABAAAAAAAAAA5wcmV2aW91c19hZG1pbgAAAAAAEwAAAAAAAAAC",
        "AAAABQAAADJFdmVudCBlbWl0dGVkIHdoZW4gYW4gYWRtaW4gdHJhbnNmZXIgaXMgaW5pdGlhdGVkLgAAAAAAAAAAABZBZG1pblRyYW5zZmVySW5pdGlhdGVkAAAAAAABAAAAGGFkbWluX3RyYW5zZmVyX2luaXRpYXRlZAAAAAMAAAAAAAAADWN1cnJlbnRfYWRtaW4AAAAAAAATAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAAAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAAAAAAC",
        "AAAAAQAAADFTdG9yYWdlIGtleSBmb3IgZW51bWVyYXRpb24gb2YgYWNjb3VudHMgcGVyIHJvbGUuAAAAAAAAAAAAAA5Sb2xlQWNjb3VudEtleQAAAAAAAgAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAAAAAARyb2xlAAAAEQ==",
        "AAAAAgAAADxTdG9yYWdlIGtleXMgZm9yIHRoZSBkYXRhIGFzc29jaWF0ZWQgd2l0aCB0aGUgYWNjZXNzIGNvbnRyb2wAAAAAAAAAF0FjY2Vzc0NvbnRyb2xTdG9yYWdlS2V5AAAAAAcAAAAAAAAAAAAAAA1FeGlzdGluZ1JvbGVzAAAAAAAAAQAAAAAAAAAMUm9sZUFjY291bnRzAAAAAQAAB9AAAAAOUm9sZUFjY291bnRLZXkAAAAAAAEAAAAAAAAAB0hhc1JvbGUAAAAAAgAAABMAAAARAAAAAQAAAAAAAAARUm9sZUFjY291bnRzQ291bnQAAAAAAAABAAAAEQAAAAEAAAAAAAAACVJvbGVBZG1pbgAAAAAAAAEAAAARAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAAAAAAAAAAAAAxQZW5kaW5nQWRtaW4=",
        "AAAABAAAAAAAAAAAAAAADE93bmFibGVFcnJvcgAAAAMAAAAAAAAAC093bmVyTm90U2V0AAAACDQAAAAAAAAAElRyYW5zZmVySW5Qcm9ncmVzcwAAAAAINQAAAAAAAAAPT3duZXJBbHJlYWR5U2V0AAAACDY=",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg==",
        "AAAAAgAAACNTdG9yYWdlIGtleXMgZm9yIGBPd25hYmxlYCB1dGlsaXR5LgAAAAAAAAAAEU93bmFibGVTdG9yYWdlS2V5AAAAAAAAAgAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAMUGVuZGluZ093bmVy"
    ]);

    // Result parsers for functions that return values
    static readonly parsers = {
        // Returns (position_id: u32, fee: i128)
        openPosition: (result: string): [u32, i128] =>
            TradingContract.spec.funcResToNative('open_position', result),
        // Returns (pnl: i128, fee: i128)
        closePosition: (result: string): [i128, i128] =>
            TradingContract.spec.funcResToNative('close_position', result),
        // Returns interest fee: i128
        modifyCollateral: (result: string): i128 =>
            TradingContract.spec.funcResToNative('modify_collateral', result),
        // Returns Vec<u32> result codes
        execute: (result: string): u32[] =>
            TradingContract.spec.funcResToNative('execute', result),
        // Returns owner address
        owner: (result: string): Address =>
            TradingContract.spec.funcResToNative('owner', result),
    };

    /**
     * Deploy a new instance of the Trading contract
     * @param deployer - Address of the deployer (becomes owner)
     * @param wasmHash - Hash of the Trading WASM contract code
     * @param salt - Optional salt for deterministic address
     * @param format - Format of wasmHash if string ('hex' or 'base64')
     * @returns Base64-encoded XDR operation
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        salt?: Buffer,
        format: 'hex' | 'base64' = 'hex'
    ): string {
        return Operation.createCustomContract({
            address: Address.fromString(deployer),
            wasmHash: typeof wasmHash === 'string'
                ? Buffer.from(wasmHash, format)
                : wasmHash,
            salt,
            constructorArgs: this.spec.funcArgsToScVals('__constructor', {
                owner: deployer,
            }),
        }).toXDR('base64');
    }

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Initialize the trading contract (owner only)
     * @param args - Initialize arguments (name, vault, config)
     * @returns XDR operation string
     */
    initialize(args: InitializeArgs): string {
        return this.call(
            'initialize',
            nativeToScVal(args.name, { type: 'string' }),
            Address.fromString(args.vault).toScVal(),
            this.tradingConfigToScVal(args.config),
        ).toXDR('base64');
    }

    /**
     * Queue a configuration update (owner only)
     * @param config - New trading configuration
     * @returns XDR operation string
     */
    queueSetConfig(config: TradingConfigArgs): string {
        return this.call(
            'queue_set_config',
            this.tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Cancel a queued configuration update (owner only)
     * @returns XDR operation string
     */
    cancelSetConfig(): string {
        return this.call('cancel_set_config').toXDR('base64');
    }

    /**
     * Execute queued configuration update
     * @returns XDR operation string
     */
    setConfig(): string {
        return this.call('set_config').toXDR('base64');
    }

    /**
     * Queue setting data for a market (owner only)
     * @param args - Asset and market configuration
     * @returns XDR operation string
     */
    queueSetMarket(args: QueueSetMarketArgs): string {
        return this.call(
            'queue_set_market',
            assetToScVal(args.asset),
            this.marketConfigToScVal(args.config),
        ).toXDR('base64');
    }

    /**
     * Cancel a queued market initialization (owner only)
     * @param asset - The asset to cancel
     * @returns XDR operation string
     */
    cancelSetMarket(asset: Asset): string {
        return this.call(
            'cancel_set_market',
            assetToScVal(asset),
        ).toXDR('base64');
    }

    /**
     * Execute queued market setup
     * @param asset - The asset to setup
     * @returns XDR operation string
     */
    setMarket(asset: Asset): string {
        return this.call(
            'set_market',
            assetToScVal(asset),
        ).toXDR('base64');
    }

    /**
     * Set the trading contract status (owner only)
     * @param status - ContractStatus enum value:
     *   - Active (0): Full operation - all trading actions allowed
     *   - OnIce (1): Blocks new positions, allows closing/modifying
     *   - Frozen (2): Emergency lockdown - no trading actions
     *   - Setup (99): Initial setup mode - no trading, immediate config changes
     * @returns XDR operation string
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Upgrade contract WASM (owner only)
     * @param wasmHash - New WASM hash (32 bytes)
     * @returns XDR operation string
     */
    upgrade(wasmHash: Buffer | Uint8Array): string {
        const hashBuffer = wasmHash instanceof Buffer ? wasmHash : Buffer.from(wasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hashBuffer),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable Methods
    // ============================================================

    /**
     * Get the contract owner
     * @returns XDR operation string
     */
    owner(): string {
        return this.call('owner').toXDR('base64');
    }

    /**
     * Transfer ownership to a new address (owner only)
     * @param newOwner - New owner address
     * @returns XDR operation string
     */
    transferOwnership(newOwner: Address | string): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
        ).toXDR('base64');
    }

    /**
     * Renounce ownership (owner only)
     * @returns XDR operation string
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // Trading Methods
    // ============================================================

    /**
     * Open a new position
     * @param args - Position opening arguments
     * @returns XDR operation string
     */
    openPosition(args: OpenPositionArgs): string {
        const userAddress = typeof args.user === 'string'
            ? Address.fromString(args.user)
            : args.user;

        return this.call(
            'open_position',
            userAddress.toScVal(),
            xdr.ScVal.scvU32(args.asset_index),
            nativeToScVal(args.collateral, { type: 'i128' }),
            nativeToScVal(args.notional_size, { type: 'i128' }),
            xdr.ScVal.scvBool(args.is_long),
            nativeToScVal(args.entry_price, { type: 'i128' }),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Close a position (user auth required)
     * @param positionId - Position ID to close
     * @returns XDR operation string
     */
    closePosition(positionId: u32): string {
        return this.call(
            'close_position',
            xdr.ScVal.scvU32(positionId),
        ).toXDR('base64');
    }

    /**
     * Modify collateral on an open position
     * @param args - Modify collateral arguments
     * @returns XDR operation string
     */
    modifyCollateral(args: ModifyCollateralArgs): string {
        return this.call(
            'modify_collateral',
            xdr.ScVal.scvU32(args.position_id),
            nativeToScVal(args.new_collateral, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Set take profit and stop loss triggers
     * @param args - Set triggers arguments
     * @returns XDR operation string
     */
    setTriggers(args: SetTriggersArgs): string {
        return this.call(
            'set_triggers',
            xdr.ScVal.scvU32(args.position_id),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Execute keeper actions (Fill, StopLoss, TakeProfit, Liquidate)
     * @param caller - Keeper address receiving fees
     * @param requests - Array of execute requests
     * @returns XDR operation string
     */
    execute(caller: Address | string, requests: ExecuteRequest[]): string {
        const callerAddress = typeof caller === 'string'
            ? Address.fromString(caller)
            : caller;

        const requestsScVal = xdr.ScVal.scvVec(
            requests.map(req => this.executeRequestToScVal(req))
        );

        return this.call(
            'execute',
            callerAddress.toScVal(),
            requestsScVal,
        ).toXDR('base64');
    }

    // ============================================================
    // Internal Helpers
    // ============================================================

    /**
     * Convert TradingConfigArgs to ScVal
     * @internal
     */
    private tradingConfigToScVal(config: TradingConfigArgs): xdr.ScVal {
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('caller_take_rate'),
                val: nativeToScVal(config.caller_take_rate, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_positions'),
                val: xdr.ScVal.scvU32(config.max_positions),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_utilization'),
                val: nativeToScVal(config.max_utilization, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('oracle'),
                val: Address.fromString(config.oracle).toScVal(),
            }),
        ]);
    }

    /**
     * Convert MarketConfigArgs to ScVal
     * @internal
     */
    private marketConfigToScVal(config: MarketConfigArgs): xdr.ScVal {
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('base_fee'),
                val: nativeToScVal(config.base_fee, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('base_hourly_rate'),
                val: nativeToScVal(config.base_hourly_rate, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('enabled'),
                val: xdr.ScVal.scvBool(config.enabled),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('init_margin'),
                val: nativeToScVal(config.init_margin, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('maintenance_margin'),
                val: nativeToScVal(config.maintenance_margin, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_collateral'),
                val: nativeToScVal(config.max_collateral, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_payout'),
                val: nativeToScVal(config.max_payout, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('min_collateral'),
                val: nativeToScVal(config.min_collateral, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('price_impact_scalar'),
                val: nativeToScVal(config.price_impact_scalar, { type: 'i128' }),
            }),
        ]);
    }

    /**
     * Convert ExecuteRequest to ScVal
     * @internal
     */
    private executeRequestToScVal(request: ExecuteRequest): xdr.ScVal {
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('position_id'),
                val: xdr.ScVal.scvU32(request.position_id),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('request_type'),
                val: this.executeRequestTypeToScVal(request.request_type),
            }),
        ]);
    }

    /**
     * Convert ExecuteRequestType enum to ScVal
     * @internal
     */
    private executeRequestTypeToScVal(requestType: ExecuteRequestType): xdr.ScVal {
        let variantName: string;
        switch (requestType) {
            case ExecuteRequestType.Fill:
                variantName = 'Fill';
                break;
            case ExecuteRequestType.StopLoss:
                variantName = 'StopLoss';
                break;
            case ExecuteRequestType.TakeProfit:
                variantName = 'TakeProfit';
                break;
            case ExecuteRequestType.Liquidate:
                variantName = 'Liquidate';
                break;
            default:
                throw new Error(`Unknown ExecuteRequestType: ${requestType}`);
        }

        return xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol(variantName),
        ]);
    }
}
